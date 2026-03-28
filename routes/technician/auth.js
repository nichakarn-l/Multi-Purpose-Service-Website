const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isTechnicianLoggedIn } = require('../../middlewares/technicianAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

// login page
router.get('/login', (req, res) => {
  res.render('technician/login');
});

// POST login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 AND role = 'technician'`,
      [email]
    );

    const technician = result.rows[0];
    if (!technician) {
      return res.send('ไม่สามารถเข้าสู่ระบบได้ กรุณาตรวจสอบข้อมูลอีกครั้ง');
    }

    const match = await bcrypt.compare(password, technician.password);
    if (match) {
      req.session.user = {
        id: technician.id,
        role: technician.role
      };
      res.redirect('/technician/dashboard');
    } else {
      res.send('รหัสผ่านไม่ถูกต้อง');
    }
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.log('Logout error:', err);
      return res.send('เกิดข้อผิดพลาดขณะออกจากระบบ');
    }
    res.redirect('/technician/login');
  });
});

module.exports = router;