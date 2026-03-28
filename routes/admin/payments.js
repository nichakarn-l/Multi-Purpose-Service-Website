const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isAdminLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

// GET ทั้งหมด
router.get('/', isAdminLoggedIn, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        p.*, 
        b.booking_date, 
        b.booking_time,
        b.id AS booking_id,
        b.status AS booking_status,
        u.email AS user_email,
        up.first_name,
        up.last_name,
        s.name AS service_name
      FROM payments p
      LEFT JOIN bookings b ON p.booking_id = b.id
      LEFT JOIN users u ON b.user_id = u.id
      LEFT JOIN user_profiles up ON u.id = up.user_id
      LEFT JOIN services s ON b.service_id = s.id
      ORDER BY p.payment_date ASC
    `);


    // แยกเฉพาะรายการรอตรวจสอบ
    const pendingPayments = result.rows.filter(payment => payment.status === 'awaiting_review');

    res.render('admin/payments/list', {
      currentPage: 'payments',
      payments: result.rows,
      pendingPayments,
    });
  } catch (err) {
    console.error('Error fetching payments:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการโหลดข้อมูลการชำระเงิน');
  }
});



// อนุมัติการชำระเงิน
router.post('/confirm', isAdminLoggedIn, async (req, res) => {
  const { payment_id } = req.body;
  try {
    // อัพเดตสถานะ payment เป็น confirmed
    await pool.query(
      `UPDATE payments SET status = 'confirmed' WHERE id = $1`,
      [payment_id]
    );

    // ดึง booking_id จาก payments
    const paymentResult = await pool.query(
      `SELECT booking_id FROM payments WHERE id = $1`,
      [payment_id]
    );

    if (paymentResult.rows.length > 0) {
      const bookingId = paymentResult.rows[0].booking_id;

      // อัพเดตสถานะ booking เป็น scheduled
      await pool.query(
        `UPDATE bookings SET status = 'scheduled' WHERE id = $1`,
        [bookingId]
      );
    }

    res.redirect('/admin/payments');
  } catch (err) {
    console.error('Confirm payment error:', err);
    res.status(500).send('ไม่สามารถยืนยันการชำระเงินได้');
  }
});




// ปฏิเสธการชำระเงิน
router.post('/reject', isAdminLoggedIn, async (req, res) => {
  const { payment_id } = req.body;
  try {
    await pool.query(
      `UPDATE payments SET status = 'rejected' WHERE id = $1`,
      [payment_id]
    );
    
    // ดึง booking_id จาก payments
    const paymentResult = await pool.query(
      `SELECT booking_id FROM payments WHERE id = $1`,
      [payment_id]
    );

    if (paymentResult.rows.length > 0) {
      const bookingId = paymentResult.rows[0].booking_id;

      // อัพเดตสถานะ booking
      await pool.query(
        `UPDATE bookings SET status = 'cancelled_by_system' WHERE id = $1`,
        [bookingId]
      );
    }
    
    res.redirect('/admin/payments');
  } catch (err) {
    console.error('Reject payment error:', err);
    res.status(500).send('ไม่สามารถปฏิเสธการชำระเงินได้');
  }
});

module.exports = router;
