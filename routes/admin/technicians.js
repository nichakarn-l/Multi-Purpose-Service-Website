const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isAdminLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ตั้งค่าที่เก็บรูป
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'public/uploads/technicians';
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// ฟังก์ชันแปลงวันที่จาก "6 ตุลาคม 2568" หรือ "06/10/2025" เป็น "YYYY-MM-DD"
// ฟังก์ชันแปลงวันที่ไทย → ISO
function convertDateToISO(dateStr) {
  if (!dateStr) return null;
  dateStr = dateStr.trim();

  const thaiMonths = {
    'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4,
    'พฤษภาคม': 5, 'มิถุนายน': 6, 'กรกฎาคม': 7, 'สิงหาคม': 8,
    'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12
  };

  //  รองรับ "6 ตุลาคม 2568" หรือ "6 ตุลาคม พ.ศ. 2568"
  const match = dateStr.match(/^(\d{1,2})\s+([ก-๙]+)\s*(?:พ\.ศ\.)?\s*(\d{4})$/);
  if (match) {
    const [, day, monthName, yearStr] = match;
    const month = thaiMonths[monthName];
    if (!month) return null;
    const year = parseInt(yearStr, 10) - 543; // แปลงจาก พ.ศ. → ค.ศ.
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  //  รองรับ "06/10/2025", "06-10-2025", หรือ "2025-10-06"
  const parts = dateStr.split(/[\/\-.]/);
  if (parts.length === 3) {
    let [a, b, c] = parts.map(p => p.trim());
    if (a.length === 4) {
      // YYYY-MM-DD
      return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
    } else {
      // DD-MM-YYYY หรือ DD/MM/YYYY
      let dd = a, mm = b, yy = c;
      if (parseInt(yy, 10) > 2500) yy = parseInt(yy, 10) - 543;
      return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    }
  }

  return null;
}



// แสดงรายชื่อช่าง
router.get('/', isAdminLoggedIn, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        t.*, 
        sc.name AS category_name
      FROM technicians t
      LEFT JOIN service_categories sc ON t.category_id = sc.id
      WHERE t.status = 'active'
      ORDER BY t.id
    `);

    res.render('admin/technicians/list', {
      currentPage: 'technicians',
      technicians: result.rows
    });
  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาดในการโหลดข้อมูลช่าง");
  }
});



// ฟอร์มเพิ่มช่าง
router.get('/add', isAdminLoggedIn, async (req, res) => {
  try {
    const categoryResult = await pool.query('SELECT id, name FROM service_categories');
    const categories = categoryResult.rows;

    const serviceResult = await pool.query('SELECT id, name, service_category_id FROM services WHERE is_active = true');
    const services = serviceResult.rows;

    res.render('admin/technicians/add', {
      currentPage: 'technicians',
      categories,
      services
    });
  } catch (err) {
    console.error('Error loading form data:', err);
    res.send("เกิดข้อผิดพลาดในการโหลดหน้าฟอร์มเพิ่มช่าง");
  }
});


// บันทึกข้อมูลช่างใหม่
router.post('/add', isAdminLoggedIn, upload.single('photo'), async (req, res) => {
  const {
    prefix, first_name, last_name, category_id, phone, email,
    password, start_date, status, birth_date, address,
    service_ids
  } = req.body;

  try {
    // แปลงวันที่ทั้งสองช่อง
    const startDateISO = convertDateToISO(start_date);
    const birthDateISO = convertDateToISO(birth_date);

    // เพิ่มการตรวจสอบค่าเบื้องต้นก่อน insert
    if (!email) {
      return res.status(400).send("กรุณากรอกอีเมล");
    }
    if (!password) {
      return res.status(400).send("กรุณากรอกรหัสผ่าน");
    }

    // ตรวจสอบว่าอีเมลซ้ำ
    const existingUser = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).send("อีเมลนี้ถูกใช้แล้ว กรุณาใช้บัญชีอีเมลอื่น");
    }


    // ตรวจสอบว่ามีเลือกบริการหรือไม่
    const serviceArray = service_ids
      ? (Array.isArray(service_ids) ? service_ids : [service_ids])
      : [];

    if (serviceArray.length === 0) {
      return res.status(400).send("กรุณาเลือกบริการอย่างน้อย 1 รายการ");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // เริ่ม transaction เพื่อความปลอดภัย (แนะนำ)
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userResult = await client.query(
        `INSERT INTO users (email, password, role) VALUES ($1, $2, 'technician') RETURNING id`,
        [email, hashedPassword]
      );
      const userId = userResult.rows[0].id;

      // ถ้ามีรูปอัปโหลด
      const photoPath = req.file ? `/uploads/technicians/${req.file.filename}` : null;

      const technicianResult = await client.query(`
        INSERT INTO technicians 
          (user_id, prefix, first_name, last_name, category_id, phone, email, birth_date, address, start_date, status, photo)
        VALUES 
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
      `, [
        userId, prefix, first_name, last_name, category_id || null, phone, email, birthDateISO, address,
        startDateISO, status || 'active', photoPath
      ]);

      const technicianId = technicianResult.rows[0].id;

      const serviceArray = service_ids
        ? (Array.isArray(service_ids) ? service_ids : [service_ids])
        : [];

      for (const serviceId of serviceArray) {
        await client.query(
          `INSERT INTO technician_services (technician_id, service_id) VALUES ($1, $2)`,
          [technicianId, serviceId]
        );
      }

      await client.query('COMMIT');
      client.release();
      res.redirect('/admin/technicians');
    } catch (txErr) {
      await client.query('ROLLBACK');
      client.release();
      console.error('Transaction error adding technician:', txErr);
      // คืนค่า error message ที่เป็นประโยชน์สำหรับดีบัก (แต่ถ้าเป็น production อาจซ่อนรายละเอียด)
      return res.status(500).send("เกิดข้อผิดพลาดในการเพิ่มข้อมูลช่าง (transaction) - " + (txErr.message || ''));
    }
  } catch (err) {
    console.error('Error in /add technician route:', err);
    // ส่งข้อความที่ชัดเจนขึ้นกลับไปยังผู้ใช้/ dev
    res.status(500).send("เกิดข้อผิดพลาดในการเพิ่มข้อมูลช่าง: " + (err.message || ''));
  }
});


// ฟอร์มแก้ไขช่าง
router.get('/edit/:id', isAdminLoggedIn, async (req, res) => {
  const technicianId = req.params.id;

  try {
    const techResult = await pool.query(`SELECT * FROM technicians WHERE id = $1`, [technicianId]);
    const technician = techResult.rows[0];

    if (!technician) return res.status(404).send("ไม่พบข้อมูลช่าง");

    // แปลงวันที่เป็นรูปแบบ d/m/Y
    if (technician.start_date) {
      const d = new Date(technician.start_date);
      technician.start_date = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    }
    if (technician.birth_date) {
      const d = new Date(technician.birth_date);
      technician.birth_date = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,'0')}-${d.getDate().toString().padStart(2,'0')}`;
    }


    // ดึง service ของช่าง
    const techServicesResult = await pool.query(
      `SELECT service_id FROM technician_services WHERE technician_id = $1`,
      [technicianId]
    );
    const service_ids = techServicesResult.rows.map(row => row.service_id);

    const categoriesResult = await pool.query(`SELECT id, name FROM service_categories`);
    const categories = categoriesResult.rows;

    const allServicesResult = await pool.query(`SELECT id, name, service_category_id FROM services WHERE is_active = true`);
    const services = allServicesResult.rows;

    res.render('admin/technicians/edit', {
      technician: { ...technician, service_ids },
      categories,
      services,
      currentPage: 'technicians'
    });
  } catch (err) {
    console.error('Error loading technician edit page:', err);
    res.send("เกิดข้อผิดพลาดในการโหลดหน้าแก้ไขช่าง");
  }
});

// อัปเดตช่าง พร้อม upload รูป
router.post('/edit/:id', isAdminLoggedIn, upload.single('photo'), async (req, res) => {
  const technicianId = req.params.id;
  let {
    prefix, first_name, last_name, phone, email, start_date, birth_date,
    status: newStatus, category_id, service_ids, old_photo, address
  } = req.body;

  // fallback ถ้าไม่ได้เลือก status ให้ใช้ค่าเดิมจาก database
  if (!newStatus) {
    const techRes = await pool.query('SELECT status FROM technicians WHERE id = $1', [technicianId]);
    newStatus = techRes.rows[0].status;
  }

  const status = newStatus; // เอาไปใช้ใน UPDATE query

  try {
    const startDateISO = convertDateToISO(start_date);
    const birthDateISO = convertDateToISO(birth_date);
    const photo = req.file ? `/uploads/technicians/${req.file.filename}` : old_photo;

    await pool.query(`
      UPDATE technicians SET
        prefix=$1, first_name=$2, last_name=$3,
        phone=$4, email=$5, start_date=$6, birth_date=$7,
        status=$8, category_id=$9, photo=$10, address=$11
      WHERE id=$12
    `, [
      prefix, first_name, last_name,
      phone, email, startDateISO, birthDateISO,
      status, category_id, photo, address,
      technicianId
    ]);

    // ลบ service เก่า
    await pool.query(`DELETE FROM technician_services WHERE technician_id = $1`, [technicianId]);

    if (service_ids) {
      const serviceArray = Array.isArray(service_ids) ? service_ids : [service_ids];
      for (let sid of serviceArray) {
        await pool.query(
          `INSERT INTO technician_services (technician_id, service_id) VALUES ($1, $2)`,
          [technicianId, sid]
        );
      }
    }

    res.redirect('/admin/technicians');
  } catch (err) {
    console.error('Error updating technician:', err);
    res.send("เกิดข้อผิดพลาดในการอัปเดตข้อมูลช่าง");
  }
});


router.post('/deactivate/:id', isAdminLoggedIn, async (req, res) => {
  const technicianId = req.params.id; //id ช่างจาก URL 

  try {
    // เช็กก่อนว่าช่างยังมีงานค้างไหม (งานที่ไม่ใช่ "เสร็จสิ้น")
    const check = await pool.query(
      `SELECT COUNT(*) AS total  
       FROM bookings
       WHERE technician_id = $1
       AND status NOT IN ('completed')`,
      [technicianId]
    );

    // ถ้ามีงานอยู่ -> ไม่อนุญาตให้ปิด
    if (check.rows[0].total > 0) {
      return res.status(400).send("ไม่สามารถปิดช่างได้ เนื่องจากยังมีงานที่ต้องให้บริการ");
    }

    //  ตั้งสถานะเป็น inactive
    await pool.query(
      'UPDATE technicians SET status = $1 WHERE id = $2',
      ['inactive', technicianId]
    );

    // ปิดการเข้าใช้งาน (disable login)
    await pool.query(
      `UPDATE users 
       SET role = $1 
       WHERE id = (SELECT user_id FROM technicians WHERE id = $2)`,
      ['disabled', technicianId]
    );

    res.status(200).send("OK");

  } catch (err) {
    console.error(err);
    res.status(500).send("เกิดข้อผิดพลาด");
  }
});


module.exports = router;
