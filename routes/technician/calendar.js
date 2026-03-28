const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isTechnicianLoggedIn } = require('../../middlewares/technicianAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

// ฟังก์ชันแปลงวันที่แบบไม่ใช้ toISOString เพื่อแก้ปัญหา timezone
function formatDateToLocal(date) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}


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
        b.id, b.service_id, b.booking_date, b.booking_time, b.status,
        s.name AS service_name,
        u.first_name, u.last_name, u.phone, u.address,
        (
          SELECT COUNT(*) 
          FROM booking_reschedules br
          WHERE br.booking_id = b.id
          AND br.requested_by = 'technician'
        ) AS reschedule_count


      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN user_profiles u ON b.user_id = u.user_id
      WHERE b.technician_id = $1
    `, [technicianId]);



    const statusMap = {
      scheduled: 'รอดำเนินการ',
      in_progress: 'กำลังเนิดการซ่อมแซม',
      completed: 'ดำเนินการเสร็จสิ้น',
      cancelled_by_system: 'ยกเลิกโดยระบบ',
      cancelled_by_user: 'ยกเลิกโดยผู้ใช้',
      cancelled_by_system: 'ยกเลิกโดยระบบ',
      no_show: 'พลาดนัดหมาย',
      need_reschedule: 'รอผู้ใช้เลือกวัน-เวลาใหม่'
    };

    //กรองไม่ให้แสดงสถานะ "ยกเลิกโดยระบบ"
    const validJobs = result.rows.filter(job => job.status !== 'cancelled_by_system');

    const events = validJobs.map(job => {
      const datePart = formatDateToLocal(job.booking_date);
      let timePart = job.booking_time;
      if (timePart.length === 5) timePart += ':00'; // เติมวินาที

      const statusLabel = statusMap[job.status] || job.status;

      return {
        title: `${job.service_name || 'ไม่มีชื่อบริการ'}`,
        start: `${datePart}T${timePart}`,
        url: `/technician/bookings/${job.id}`,
        allDay: false,
         extendedProps: {
          bookingId: job.id,
          customerName: `${job.first_name || ''} ${job.last_name || ''}`,
          phone: job.phone || '-',
          address: job.address || '-',
          status: statusLabel,
          rescheduleCount: parseInt(job.reschedule_count)

        }
      };
    });

    //ถ้าไม่มีงานเหลือเลย (เช่น ทุกงานถูกยกเลิก)
    if (events.length === 0) {
      // ส่งข้อความธรรมดาแทน ไม่ต้อง render HTML เต็มหน้า
      return res.send('ไม่มีตารางงานที่ยังไม่ถูกยกเลิก');
    }

    res.render('technician/calendar', {
      currentPage: 'calendar',
      bookings: events,      
    });

  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาดในการโหลดตารางงาน");
  }
});


router.post('/request-reschedule', isTechnicianLoggedIn, async (req, res) => {

  const { bookingId, reason, note } = req.body;
  const userId = req.session.user.id;

  try {

    const techRes = await pool.query(
      'SELECT id FROM technicians WHERE user_id = $1',
      [userId]
    );

    const technicianId = techRes.rows[0].id;

    const bookingRes = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND technician_id = $2',
      [bookingId, technicianId]
    );

    if (bookingRes.rows.length === 0) {
      return res.status(403).json({ message: 'ไม่มีสิทธิ์เลื่อนงานนี้' });
    }

    // เช็คว่าขอเลื่อนไปแล้วหรือยัง
    const MAX_RESCHEDULE = 1;   //เลื่อน

    const countRes = await pool.query(
      `SELECT COUNT(*) 
      FROM booking_reschedules 
      WHERE booking_id = $1
      AND requested_by = 'technician'`,
      [bookingId]
    );

    const rescheduleCount = parseInt(countRes.rows[0].count);

    if (rescheduleCount >= MAX_RESCHEDULE) {
      return res.status(400).json({
        message: `งานนี้สามารถเลื่อนได้ไม่เกิน ${MAX_RESCHEDULE} ครั้ง`
      });
    }
    
    // INSERT ได้แค่ครั้งเดียว
    await pool.query(`
      INSERT INTO booking_reschedules
      (booking_id, requested_by, reason, note)
      VALUES ($1, 'technician', $2, $3)
    `, [bookingId, reason, note]);

    // อัปเดตสถานะงาน
    await pool.query(`
      UPDATE bookings
      SET status = 'need_reschedule'
      WHERE id = $1
    `, [bookingId]);

    res.json({ message: 'ส่งคำขอเลื่อนเรียบร้อย' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'เกิดข้อผิดพลาด' });
  }

});



module.exports = router;
