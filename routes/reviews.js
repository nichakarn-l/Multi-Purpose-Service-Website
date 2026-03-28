const express = require('express');
const router = express.Router();
const pool = require('../db');
const { isLoggedIn } = require('../middlewares/authMiddleware');


// GET แสดงหน้ารีวิว
// GET แสดงหน้ารีวิวของฉัน
router.get('/reviews', isLoggedIn, async (req, res) => {
  try {
    const userId = req.session.user.id; // 👈 ดึง id ของ user ที่ล็อกอินอยู่

    const result = await pool.query(
      `SELECT 
          r.*, 
          u.email, 
          up.first_name, 
          up.last_name,
          s.name AS service_name       --  เพิ่มชื่อบริการ
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN bookings b ON r.booking_id = b.id   --  เชื่อมรีวิวกับการจอง
      LEFT JOIN services s ON b.service_id = s.id   --  ดึงชื่อบริการ
      WHERE r.user_id = $1
      ORDER BY r.id DESC`,
      [userId]
    );


    const reviews = result.rows;
    res.render('reviews', { reviews });
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการโหลดรีวิว');
  }
});



// POST รับรีวิวจากผู้ใช้
router.post('/customer/review', isLoggedIn, async (req, res) => {
  const userId = req.session.user.id;
  const { booking_id, rating, comment } = req.body;

  // เช็คข้อมูลเบื้องต้น
  if (!booking_id || !rating || !comment) {
    return res.json({ success: false, error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  try {
    // ตรวจสอบว่าการจองเป็นของผู้ใช้นี้จริงหรือไม่
    const bookingCheck = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [booking_id, userId]
    );

    if (bookingCheck.rows.length === 0) {
      return res.json({ success: false, error: 'ไม่พบการจองหรือไม่มีสิทธิ์รีวิว' });
    }

    // ตรวจสอบว่าผู้ใช้เคยรีวิวการจองนี้หรือยัง
    const reviewCheck = await pool.query(
      'SELECT * FROM reviews WHERE booking_id = $1 AND user_id = $2',
      [booking_id, userId]
    );

    if (reviewCheck.rows.length > 0) {
      return res.json({ success: false, error: 'คุณได้รีวิวการจองนี้แล้ว' });
    }

    // บันทึกรีวิวลงตาราง reviews
    await pool.query(
      `INSERT INTO reviews (booking_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)`,
      [booking_id, userId, rating, comment]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving review:', error);
    res.json({ success: false, error: 'เกิดข้อผิดพลาดในการบันทึกรีวิว' });
  }
});

module.exports = router;
