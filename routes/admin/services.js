const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isAdminLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/services');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });


//หน้า list
router.get('/', isAdminLoggedIn, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, sc.name AS category_name 
      FROM services s
      LEFT JOIN service_categories sc ON s.service_category_id = sc.id
      ORDER BY s.id
    `);
    res.render('admin/services/list', {
      currentPage: 'services',
      services: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// โชว์เพิ่ม
router.get('/add', isAdminLoggedIn, async (req, res) => {
  try {
    const categoriesResult = await pool.query('SELECT id, name FROM service_categories ORDER BY name');
    res.render('admin/services/add', {
      currentPage: 'services',
      categories: categoriesResult.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// --- เพิ่ม ---
router.post('/add', isAdminLoggedIn, upload.single('image'), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      name,
      description,
      base_price,
      service_category_id,
      option_name,
      option_price,
      hours,
      minutes,
      service_area,
      workflow,
      service_details,
      warranty_conditions
    } = req.body;

    const image_path = req.file ? '/uploads/services/' + req.file.filename : null;

    //  แปลง hours + minutes 
    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    const duration = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`; // --> "01:30"

    await client.query('BEGIN');

    const isActive = true;

   const insertServiceText = `
      INSERT INTO services 
        (name, description, base_price, duration, service_category_id, image_path, is_active, 
        service_area, workflow, service_details, warranty_conditions)
      VALUES ($1, $2, $3, $4::interval, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id
    `;
    const result = await client.query(insertServiceText, [
      name,
      description || null,
      base_price,
      duration,
      service_category_id || null,
      image_path,
      true,
      service_area || null,
      workflow || null,
      service_details || null,
      warranty_conditions || null
    ]);




    const serviceId = result.rows[0].id;

    // เพิ่ม options ถ้ามี
    if (option_name && option_price) {
      const optionNames = Array.isArray(option_name) ? option_name : [option_name];
      const optionPrices = Array.isArray(option_price) ? option_price : [option_price];

      for (let i = 0; i < optionNames.length; i++) {
        const nameOpt = optionNames[i];
        const priceOpt = optionPrices[i];

        if (!nameOpt || !priceOpt || isNaN(priceOpt)) continue;

        await client.query(
          `INSERT INTO service_options (service_id, option_name, option_price) VALUES ($1, $2, $3)`,
          [serviceId, nameOpt, priceOpt]
        );
      }
    }

    await client.query('COMMIT');
    res.redirect('/admin/services');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Insert Service Error');
  } finally {
    client.release();
  }
});


// --- แสดงหน้าแก้ไขบริการ ---
router.get('/edit/:id', isAdminLoggedIn, async (req, res) => {
  try {
    const { id } = req.params;

    const [serviceResult, categoriesResult, optionsResult] = await Promise.all([
      pool.query('SELECT * FROM services WHERE id = $1', [id]),
      pool.query('SELECT id, name FROM service_categories ORDER BY name'),
      pool.query('SELECT * FROM service_options WHERE service_id = $1', [id])
    ]);

    if (serviceResult.rows.length === 0) {
      return res.status(404).send('ไม่พบบริการนี้');
    }

    const service = serviceResult.rows[0];
    const options = optionsResult.rows;

    // แยก duration ออกเป็นชั่วโมง/นาที
    let hours = 0;
    let minutes = 0;

    if (service.duration) {
      if (typeof service.duration === 'string') {
        // format "HH:MM:SS"
        const parts = service.duration.split(':').map(Number);
        hours = parts[0] || 0;
        minutes = parts[1] || 0;
      } else if (typeof service.duration === 'object') {
        // PostgreSQL interval เป็น object
        // ตัวอย่าง: { hours: 1, minutes: 30, seconds: 0 }
        hours = service.duration.hours || 0;
        minutes = service.duration.minutes || 0;
      }
    }

    res.render('admin/services/edit', {
      currentPage: 'services',
      categories: categoriesResult.rows,
      service,
      options,
      hours,
      minutes
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


// --- บันทึกการแก้ไขบริการ ---
router.post('/edit/:id', isAdminLoggedIn, upload.single('image'), async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const {
      name,
      description,
      base_price,
      service_category_id,
      option_name,
      option_price,
      hours,
      minutes,
      service_area,
      workflow,
      service_details,
      warranty_conditions
    } = req.body;

    const h = parseInt(hours) || 0;
    const m = parseInt(minutes) || 0;
    const duration = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

    const image_path = req.file ? '/uploads/services/' + req.file.filename : null;

    await client.query('BEGIN');

    // ดึง path เดิม
    const oldService = await client.query('SELECT image_path FROM services WHERE id = $1', [id]);

    // อัปเดตข้อมูลหลัก
    await client.query(
      `UPDATE services
        SET name=$1, description=$2, base_price=$3, duration=$4::interval,
            service_category_id=$5, image_path=COALESCE($6, image_path), 
            service_area=$7, workflow=$8, service_details=$9, warranty_conditions=$10
        WHERE id=$11`,
      [
        name,
        description || null,
        base_price,
        duration,
        service_category_id || null,
        image_path,
        service_area || null,
        workflow || null,
        service_details || null,
        warranty_conditions || null,
        id
      ]
    );




    // ลบ options เดิมก่อน
    await client.query('DELETE FROM service_options WHERE service_id = $1', [id]);

    // เพิ่ม options ใหม่
    if (option_name && option_price) {
      const names = Array.isArray(option_name) ? option_name : [option_name];
      const prices = Array.isArray(option_price) ? option_price : [option_price];
      for (let i = 0; i < names.length; i++) {
        if (!names[i] || !prices[i]) continue;
        await client.query(
          `INSERT INTO service_options (service_id, option_name, option_price) VALUES ($1, $2, $3)`,
          [id, names[i], prices[i]]
        );
      }
    }

    await client.query('COMMIT');
    res.redirect('/admin/services');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).send('Update Service Error');
  } finally {
    client.release();
  }
});



// ปิดการใช้งานบริการ
router.post('/deactivate/:id', isAdminLoggedIn, async (req, res) => {
  try {
    await pool.query(
      'UPDATE services SET is_active = FALSE WHERE id = $1',
      [req.params.id]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Deactivate Service Error:', err);
    res.status(500).send('Deactivate Service Error');
  }
});

// เปิดการใช้งานบริการ (ถ้าต้องการ)
router.post('/activate/:id', isAdminLoggedIn, async (req, res) => {
  try {
    await pool.query(
      'UPDATE services SET is_active = TRUE WHERE id = $1',
      [req.params.id]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Activate Service Error:', err);
    res.status(500).send('Activate Service Error');
  }
});


module.exports = router;