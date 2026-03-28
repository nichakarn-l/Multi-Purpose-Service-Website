const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isAdminLoggedIn } = require('../../middlewares/adminAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

router.get('/dashboard', isAdminLoggedIn, async (req, res) => {
  try {
    // --- ดึงข้อมูลสรุปหลัก ---
    const techResult = await pool.query(`SELECT COUNT(*) AS total_techs FROM users WHERE role = 'technician'`);
    const userResult = await pool.query(`SELECT COUNT(*) AS total_users FROM users WHERE role = 'user'`);
    const paymentResult = await pool.query(`SELECT COUNT(*) AS total_payments FROM payments`);

    // --- ดึงข้อมูลจำนวนการจองต่อเดือน (6 เดือนล่าสุด) ---
    const bookingsByMonth = await pool.query(`
      SELECT 
        TO_CHAR(booking_date, 'Mon') AS month,
        COUNT(*) AS count
      FROM bookings
      WHERE booking_date >= NOW() - INTERVAL '6 months'
      GROUP BY 1
      ORDER BY MIN(booking_date)
    `);

    // --- ดึงข้อมูลรายได้ต่อเดือนจาก payments (6 เดือนล่าสุด) ---
    const revenueByMonth = await pool.query(`
      SELECT 
        TO_CHAR(payment_date, 'Mon') AS month,
        SUM(amount) AS total
      FROM payments
      WHERE payment_date >= NOW() - INTERVAL '6 months'
      GROUP BY 1
      ORDER BY MIN(payment_date)
    `);


    res.render('admin/dashboard', {
      currentPage: 'dashboard',
      totalTechnicians: techResult.rows[0].total_techs,
      totalUsers: userResult.rows[0].total_users,
      totalPayments: paymentResult.rows[0].total_payments,
      bookingsChart: bookingsByMonth.rows,
      revenueChart: revenueByMonth.rows
    });

  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).send('เกิดข้อผิดพลาดในหน้า dashboard');
  }
});





module.exports = router;