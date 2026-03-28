const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isLoggedIn } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const pool = require('../db');


// หน้า login 
router.get('/login', (req, res) => {
  res.render('login');
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      `SELECT users.*, user_profiles.first_name, user_profiles.last_name
       FROM users
       LEFT JOIN user_profiles ON users.id = user_profiles.user_id
       WHERE users.email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !user.password) {
      return res.send('บัญชีนี้ไม่มีอยู่ หรือใช้ Google Login เท่านั้น');
    }

    const match = await bcrypt.compare(password, user.password);

    if (match) {
      //เช็ค role ก่อนให้ login
      if (user.role !== 'user') {
        return res.send('บัญชีนี้ไม่สามารถเข้าสู่ระบบผ่านหน้านี้ได้');
      }

      // เก็บ session เฉพาะ user
      req.session.user = {
        id: user.id,
        name: user.first_name + ' ' + user.last_name,
        role: user.role
      };
      res.redirect('/');
    } else {
      res.send('รหัสผ่านไม่ถูกต้อง');
    }
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


// register page
router.get('/register', (req, res) => {
  res.render('register');
});

router.post('/register', async (req, res) => {
  const { first_name, last_name, phone, email, password } = req.body;

  try {
    // ตรวจสอบ email ซ้ำ
    const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.send('อีเมลนี้ถูกใช้แล้ว');
    }

    // เข้ารหัสรหัสผ่าน
    const hashedPassword = await bcrypt.hash(password, 10);

    // เพิ่ม user ใหม่ลง DB และได้ id คืนมา
    const result = await pool.query(
      'INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id',
      [email, hashedPassword, 'user']
    );

    const newUserId = result.rows[0].id;

    await pool.query(
      `INSERT INTO user_profiles (user_id, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4)`,
      [newUserId, first_name, last_name, phone]
    );

    // set session ให้เหมือน login
    req.session.user = {
      id: newUserId,
      name: first_name + ' ' + last_name,
      role: 'user'
    };

    // ไปหน้า index
    res.redirect('/');
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});



// Google OAuth
router.get('/auth/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })
);

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    req.session.user = req.user;
    res.redirect('/');
  }
);

// logout
router.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.redirect('/login');
    });
  });
});


router.get('/select-login', (req, res) => {
  res.render('login_select'); // ชื่อไฟล์ login_select.ejs ที่อยู่ในโฟลเดอร์ views
});




module.exports = router;
