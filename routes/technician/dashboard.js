const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isTechnicianLoggedIn } = require('../../middlewares/technicianAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

router.get('/', isTechnicianLoggedIn, async (req, res) => {
  try {
    const userId = req.session.user.id;

    const techRes = await pool.query(
      'SELECT id FROM technicians WHERE user_id = $1',
      [userId]
    );
    if (techRes.rows.length === 0) {
      return res.send('ไม่พบข้อมูลช่างในระบบ');
    }
    const technicianId = techRes.rows[0].id;

    const bookingsRes = await pool.query(`
      SELECT b.*, s.name AS service_name
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.technician_id = $1
    `, [technicianId]);

    const allJobs = bookingsRes.rows;

    const total = allJobs.length;
    const completed = allJobs.filter(job => job.status === 'completed').length;

    const todayDate = new Date().toLocaleDateString('sv-SE'); // ได้รูปแบบ YYYY-MM-DD

    const todayJobs = allJobs
      .filter(job => {
        const jobDate = new Date(job.booking_date).toLocaleDateString('sv-SE');
        return jobDate === todayDate;
      })
      .sort((a, b) => {
        if (a.booking_time < b.booking_time) return -1;
        if (a.booking_time > b.booking_time) return 1;
        return 0;
      });


    res.render('technician/dashboard', {
      currentPage: 'dashboard',
      stats: {
        total,
        completed,
        today: todayJobs
      }
    });

  } catch (error) {
    console.error(error);
    res.send('เกิดข้อผิดพลาดในการโหลดข้อมูลสถิติ');
  }
});

module.exports = router;