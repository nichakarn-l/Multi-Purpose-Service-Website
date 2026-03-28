const express = require('express');
const router = express.Router();
const passport = require('passport');
const { isTechnicianLoggedIn } = require('../../middlewares/technicianAuth');
const bcrypt = require('bcrypt');
const pool = require('../../db');

// ตารางงานของช่าง
router.get('/', isTechnicianLoggedIn, async (req, res) => {
  const userId = req.session.user.id; // id ของ users

  try {
    // หา technician id ที่สัมพันธ์กับ user id นี้ก่อน
    const techRes = await pool.query(
      'SELECT id FROM technicians WHERE user_id = $1',
      [userId]
    );

    if (techRes.rows.length === 0) {
      return res.send('ไม่พบข้อมูลช่างในระบบ');
    }

    const technicianId = techRes.rows[0].id;

    // ค่อยดึง booking ตาม technician_id
    const result = await pool.query(`
      SELECT 
        b.id,
        b.booking_date,
        b.booking_time,
        b.point_count,
        b.status,
        b.total_price,
        b.deposit_amount,
        b.total_amount,
        s.name AS service_name,
        up.first_name,
        up.last_name,
        up.phone,
        up.house_number,
        up.road,
        up.suburb,
        up.district,
        up.city,
        up.postcode,
        up.latitude,
        up.longitude
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      LEFT JOIN user_profiles up ON up.user_id = b.user_id
      WHERE b.technician_id = $1
        AND b.status IN ('scheduled', 'in_progress', 'completed', 'no_show' ,'need_reschedule')
      ORDER BY
        CASE WHEN b.booking_date = CURRENT_DATE THEN 0 ELSE 1 END,
        b.booking_date ASC,
        b.booking_time ASC
    `, [technicianId]);


    const statusMap = {
    scheduled: 'รอดำเนินการ',
    in_progress: 'กำลังเนิดการซ่อมแซม',
    completed: 'ดำเนินการเสร็จสิ้น',
    cancelled_by_user: 'ยกเลิกโดยผู้ใช้',
    cancelled_by_system: 'ยกเลิกโดยระบบ',
    no_show: 'พลาดนัดหมาย',
    need_reschedule: 'รอผู้ใช้เลือกวัน-เวลาใหม่'
  };

  const bookings = result.rows.map(b => ({
    ...b,
    customer_name: b.first_name && b.last_name ? `${b.first_name} ${b.last_name}` : '-',
    status_text: statusMap[b.status] || '-',
    
    //ฟอร์แมตราคาให้อ่านง่าย
    total_price_fmt: b.total_price ? Number(b.total_price).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-',
    deposit_amount_fmt: b.deposit_amount ? Number(b.deposit_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-',
    total_amount_fmt: b.total_amount ? Number(b.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-'
  }));


    res.render('technician/bookings', { bookings, currentPage: 'bookings' });
  } catch (err) {
    console.error('Error loading bookings:', err);
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


// อัปเดตสถานะงาน
router.post('/update', isTechnicianLoggedIn, async (req, res) => {
  const userId = req.session.user.id;
  const { booking_id, new_status } = req.body;

  // อนุญาตแค่ 2 สถานะ
  const allowedStatuses = ['in_progress', 'completed'];
  if (!allowedStatuses.includes(new_status)) {
    return res.status(400).send('สถานะไม่ถูกต้อง');
  }

  try {
    // หา technician id ของช่างที่ล็อกอิน
    const techRes = await pool.query(
      'SELECT id FROM technicians WHERE user_id = $1',
      [userId]
    );
    const technicianId = techRes.rows[0].id;

    // ดึง booking เพื่อตรวจสอบสถานะเดิม
    const bookingRes = await pool.query(
      'SELECT status FROM bookings WHERE id = $1 AND technician_id = $2',
      [booking_id, technicianId]
    );

    if (bookingRes.rows.length === 0) {
      return res.status(404).send('ไม่พบงานนี้ หรือไม่ใช่งานของคุณ');
    }

    const currentStatus = bookingRes.rows[0].status;

    //บังคับลำดับสถานะ
    if (
      (currentStatus === 'scheduled' && new_status !== 'in_progress') ||
      (currentStatus === 'in_progress' && new_status !== 'completed')
    ) {
      return res.status(400).send('เปลี่ยนสถานะไม่ถูกลำดับ');
    }

    await pool.query(
      'UPDATE bookings SET status = $1 WHERE id = $2',
      [new_status, booking_id]
    );

    res.redirect('/technician/bookings');
  } catch (err) {
    console.error('Error updating status:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการอัปเดตสถานะ');
  }
});

module.exports = router;