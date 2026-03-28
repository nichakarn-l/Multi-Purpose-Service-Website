const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

// login page
router.get('/login', (req, res) => {
  res.render('admin/login');
});

// POST login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE email = $1 AND role = 'admin'`,
      [email]
    );

    const admin = result.rows[0];
    if (!admin) {
      return res.send('ไม่พบบัญชีผู้ดูแลระบบนี้');
    }

    const match = await bcrypt.compare(password, admin.password);
    if (match) {
      req.session.user = {
        id: admin.id,
        role: admin.role
      };
      res.redirect('/admin/dashboard');
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
    res.redirect('/admin/login');
  });
});

module.exports = router;
