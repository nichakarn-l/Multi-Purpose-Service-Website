const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isTechnicianLoggedIn } = require('../../middlewares/technicianAuth');
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


// หน้าโปรไฟล์ช่าง
// ดูข้อมูล profile
router.get('/', isTechnicianLoggedIn, async (req, res) => {
  const userId = req.session.user.id;

  const result = await pool.query(
    `SELECT t.*, u.email AS user_email
     FROM technicians t
     JOIN users u ON t.user_id = u.id
     WHERE t.user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).send('ไม่พบข้อมูลช่าง');
  }

  const technician = result.rows[0];

  res.render('technician/profile', {
    technician,
    currentPage: 'profile',
  });
});

// หน้า edit profile
router.get('/edit', isTechnicianLoggedIn, async (req, res) => {
  const userId = req.session.user.id;

  const result = await pool.query(
    `SELECT t.*, u.email AS user_email
     FROM technicians t
     JOIN users u ON t.user_id = u.id
     WHERE t.user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return res.status(404).send('ไม่พบข้อมูลช่าง');
  }

  const technician = result.rows[0];

  res.render('technician/edit-profile', {
    technician,
    currentPage: 'profile', // ให้ sidebar active
  });
});

// แปลงวันที่จาก "12 พฤศจิกายน 2553" เป็น "2010-11-12"
function convertThaiDateToISO(dateStr) {
  if (!dateStr) return null;

  const monthsTH = {
    'มกราคม':'01','กุมภาพันธ์':'02','มีนาคม':'03','เมษายน':'04',
    'พฤษภาคม':'05','มิถุนายน':'06','กรกฎาคม':'07','สิงหาคม':'08',
    'กันยายน':'09','ตุลาคม':'10','พฤศจิกายน':'11','ธันวาคม':'12'
  };

  const parts = dateStr.trim().replace(/\s+/g,' ').split(' ');
  if (parts.length !== 3) return null;

  const dd = parts[0].padStart(2,'0');
  const mm = monthsTH[parts[1]];
  if (!mm) return null;

  let yy = Number(parts[2]);
  if (yy > 2500) yy -= 543; // แปลงเป็น ค.ศ.

  return `${yy}-${mm}-${dd}`;
}
router.post('/edit', isTechnicianLoggedIn, upload.single('photo'), async (req, res) => {
  const userId = req.session.user.id;
  const { first_name, last_name, phone, address, old_photo } = req.body;

  // birth_date ตอนนี้เป็น "YYYY-MM-DD" จาก hidden input
  const birthDateISO = birth_date || null;

  // จัดการรูป
  let photoFilename = old_photo;
  if (req.file) {
    photoFilename = '/uploads/technicians/' + req.file.filename;
  }

  try {
    await pool.query(
      `UPDATE technicians
      SET first_name=$1, last_name=$2, phone=$3, address=$4, photo=$5
      WHERE user_id=$6`,
      [first_name, last_name, phone, address, photoFilename, userId]
    );

    res.redirect('/technician/profile');
  } catch (err) {
    console.error(err);
    res.status(500).send('เกิดข้อผิดพลาดในการบันทึกข้อมูล: ' + err.message);
  }
});




module.exports = router;
