const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isTechnicianLoggedIn } = require('../../middlewares/technicianAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');


router.get('/', isTechnicianLoggedIn, async (req, res) => {
  const userId = req.session.user.id;

  try {
    const techRes = await pool.query(
      'SELECT id FROM technicians WHERE user_id = $1',
      [userId]
    );

    if (techRes.rows.length === 0) {
      return res.send('ไม่พบข้อมูลช่างในระบบ');
    }

    const technicianId = techRes.rows[0].id;

    const result = await pool.query(`
      SELECT 
        b.id,
        b.booking_date,
        b.booking_time,
        b.status,
        b.final_price,
        s.name AS service_name,
        up.first_name,
        up.last_name
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      LEFT JOIN user_profiles up ON up.user_id = b.user_id
      WHERE b.technician_id = $1
        AND b.status = 'completed'
      ORDER BY b.booking_date DESC, b.booking_time DESC
    `, [technicianId]);

    const statusMap = {
      completed: 'เสร็จสิ้น'
    };

    const bookings = result.rows.map(b => ({
      ...b,
      customer_name: b.first_name && b.last_name ? `${b.first_name} ${b.last_name}` : '-',
      status_text: statusMap[b.status] || '-'
    }));

    res.render('technician/completed', {
      bookings,
      currentPage: 'completed'
    });
  } catch (err) {
    console.error('Error loading completed bookings:', err);
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

module.exports = router;