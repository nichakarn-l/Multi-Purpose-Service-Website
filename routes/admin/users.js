const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isAdminLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

router.get('/', isAdminLoggedIn, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id AS user_id, 
        p.id AS profile_id, 
        u.email, 
        u.role,
        p.first_name, 
        p.last_name, 
        p.phone, 
        p.address
      FROM users u
      LEFT JOIN user_profiles p ON u.id = p.user_id
      WHERE u.role = 'user'
        AND p.status = 'active'
      ORDER BY u.id ASC;

    `);

    res.render('admin/users/list', {
      currentPage: 'users',
      users: result.rows
    });
  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาดในการโหลดข้อมูลผู้ใช้");
  }
});

router.post('/update', isAdminLoggedIn, async (req, res) => {
  const { profile_id, first_name, last_name, email, role } = req.body;

  try {
    await pool.query(`
      UPDATE user_profiles SET first_name=$1, last_name=$2 WHERE id=$3
    `, [first_name, last_name, profile_id]);

    await pool.query(`
      UPDATE users SET email=$1, role=$2
      WHERE id = (SELECT user_id FROM user_profiles WHERE id=$3)
    `, [email, role, profile_id]);

    res.redirect('/admin/users');
  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาดในการอัปเดตข้อมูลผู้ใช้");
  }
});


//ปิดการใช้งาน
router.post('/deactivate', isAdminLoggedIn, async (req, res) => {
  const { profile_id } = req.body;

  try {

    // หา user_id จาก profile
    const userRes = await pool.query(
      'SELECT user_id FROM user_profiles WHERE id = $1',
      [profile_id]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).send('ไม่พบผู้ใช้งาน');
    }

    const user_id = userRes.rows[0].user_id;

    //เช็คว่าลูกค้ามีงานบริการค้างมั้ย
    const check = await pool.query(
      `SELECT COUNT(*) AS total
       FROM bookings
       WHERE user_id = $1
       AND status NOT IN ('completed')`,
      [user_id]
    );

    // ถ้ามีงานอยู่ → ไม่อนุญาตให้ปิด
    if (parseInt(check.rows[0].total) > 0) {
      return res.status(400).send("ไม่สามารถปิดการใช้งานได้ เนื่องจากยังมีงานที่ต้องให้บริการ");
    }


    // ปิดโปรไฟล์
    await pool.query(
      'UPDATE user_profiles SET status = $1 WHERE id = $2',
      ['inactive', profile_id]
    );

    // ปิดการใช้งาน user
    await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2',
      ['disabled', user_id]
    );
    

    res.status(200).send("ok");
  } catch (err) {
    console.error(err);
    res.status(500).send("เกิดข้อผิดพลาดในการปิดการใช้งานผู้ใช้");
  }
});


module.exports = router;