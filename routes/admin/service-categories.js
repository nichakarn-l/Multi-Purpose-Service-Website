const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isAdminLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');


// config multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads/categories');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage });

// หน้า list หมวดหมู่
router.get('/', isAdminLoggedIn, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM service_categories ORDER BY id');
    res.render('admin/service-categories/list', {
      currentPage: 'service_categories',
      categories: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// หน้าเพิ่มหมวดหมู่
router.get('/add', isAdminLoggedIn, (req, res) => {
  res.render('admin/service-categories/add', {
    currentPage: 'service_categories'
  });
});

// รับข้อมูลจาก form พร้อมอัปโหลดรูป
router.post('/add', isAdminLoggedIn, upload.single('image'), async (req, res) => {
  const { name } = req.body;
  const imagePath = '/uploads/categories/' + req.file.filename;

  try {
    await pool.query(
      'INSERT INTO service_categories (name, image_path) VALUES ($1, $2)',
      [name, imagePath]
    );
    res.redirect('/admin/service-categories');
  } catch (err) {
    console.error(err);
    res.status(500).send('Insert Error');
  }
});

//แก้ไข
router.get('/:id/edit', isAdminLoggedIn, async (req, res) => {
  const categoryId = req.params.id;
  try {
    const result = await pool.query('SELECT * FROM service_categories WHERE id = $1', [categoryId]);
    if (result.rows.length === 0) return res.status(404).send('หมวดหมู่ไม่พบ');

    res.json(result.rows[0]); // ส่งข้อมูล category ให้ modal แก้ไข
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});


router.post('/edit/:id', isAdminLoggedIn, upload.single('image'), async (req, res) => {
  const categoryId = req.params.id;
  const { name } = req.body;

  try {
    // ดึงข้อมูลเก่าเพื่อดูว่ามีรูปภาพเดิมหรือไม่
    const result = await pool.query('SELECT image_path FROM service_categories WHERE id = $1', [categoryId]);
    if (result.rows.length === 0) {
      return res.status(404).send('หมวดหมู่ไม่พบ');
    }

    let imagePath = result.rows[0].image_path;

    // ถ้ามีการอัปโหลดรูปใหม่ ให้ลบรูปเก่าและเก็บ path ใหม่
    if (req.file) {
      // ลบรูปเก่าออกจากเครื่อง (ถ้ามี)
      if (imagePath) {
        const oldFilePath = path.join(__dirname, '../../public', imagePath);
        if (fs.existsSync(oldFilePath)) {
          fs.unlinkSync(oldFilePath);
        }
      }
      // ตั้ง path รูปใหม่
      imagePath = '/uploads/categories/' + req.file.filename;
    }

    // อัพเดตข้อมูลใน DB
    await pool.query(
      'UPDATE service_categories SET name = $1, image_path = $2 WHERE id = $3',
      [name, imagePath, categoryId]
    );

    res.redirect('/admin/service-categories');
  } catch (err) {
    console.error(err);
    res.status(500).send('Update Error');
  }
});

// ปิดการใช้งาน (แทนการลบ)
router.post('/deactivate/:id', isAdminLoggedIn, async (req, res) => {
  try {
    await pool.query(
      'UPDATE service_categories SET is_active = FALSE WHERE id = $1',
      [req.params.id]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send('Deactivate Error');
  }
});


// เปิดการใช้งาน
router.post('/activate/:id', isAdminLoggedIn, async (req, res) => {
  try {
    await pool.query(
      'UPDATE service_categories SET is_active = TRUE WHERE id = $1',
      [req.params.id]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error(err);
    res.status(500).send('Activate Error');
  }
});


module.exports = router;