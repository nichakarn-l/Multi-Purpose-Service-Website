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
        b.*,
        s.name AS service_name,
        up.first_name AS user_first_name,
        up.phone AS customer_phone,
        up.last_name AS user_last_name,
        up.address AS user_address,
        t.first_name AS tech_first_name,
        t.last_name AS tech_last_name,
        t.phone AS tech_phone
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN user_profiles up ON b.user_id = up.user_id
      LEFT JOIN technicians t ON b.technician_id = t.id
      ORDER BY b.id
    `);

    const statusMap = {
      awaiting_deposit: 'รอชำระมัดจำ',
      deposit_paid: 'ชำระมัดจำแล้ว',
      scheduled: 'รอดำเนินการ',
      in_progress: 'กำลังเนิดการซ่อมแซม',
      completed: 'ดำเนินการเสร็จสิ้น',
      cancelled_by_user: 'ยกเลิกโดยผู้ใช้',
      cancelled_by_system: 'ยกเลิกโดยระบบ',
      no_show: 'ช่างไม่พร้อมให้บริการตามนัด',
      need_reschedule: 'กรุณาเลือกวัน-เวลาใหม่ เนื่องจากช่างไม่พร้อมให้บริการ',

    };

    const bookings = result.rows.map(booking => ({
      ...booking,
      status_text: statusMap[booking.status] || booking.status || '-',
      customer_name: booking.user_first_name && booking.user_last_name
        ? `${booking.user_first_name} ${booking.user_last_name}`
        : `#${booking.user_id}`,
      technician_name: booking.tech_first_name && booking.tech_last_name
        ? `${booking.tech_first_name} ${booking.tech_last_name}`
        : '-'
    }));

    res.render('admin/bookings/list', {
      currentPage: 'bookings',
      bookings,
    });
  } catch (err) {
    console.error(err);
    res.send("เกิดข้อผิดพลาดในการโหลดข้อมูลจอง");
  }
});

router.get('/:id/details-json', isAdminLoggedIn, async (req, res) => {
  try {
    const bookingId = req.params.id;

    //  ดึงข้อมูลหลักของการจอง + ข้อมูลผู้ใช้ + ข้อมูลช่าง
    const result = await pool.query(`
      SELECT 
        b.id,
        b.booking_date,
        b.booking_time,
        b.status,
        b.deposit_amount,
        b.total_amount,
        b.total_price,

        s.name AS service_name,

        --  ข้อมูลผู้จอง
        up.first_name AS user_first_name,
        up.last_name AS user_last_name,
        up.phone AS user_phone,
        up.house_number,
        up.road,
        up.suburb,
        up.district,
        up.city,
        up.postcode,
        up.latitude,
        up.longitude,

        -- ข้อมูลช่าง
        t.prefix AS tech_prefix,
        t.first_name AS tech_first_name,
        t.last_name AS tech_last_name,
        t.phone AS tech_phone,
        t.address AS tech_address

      FROM bookings b
       LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN user_profiles up ON b.user_id = up.user_id
      LEFT JOIN technicians t ON b.technician_id = t.id
      WHERE b.id = $1
    `, [bookingId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบข้อมูลการจอง' });
    }

    const b = result.rows[0];

    //  แปลงสถานะเป็นข้อความภาษาไทย
    const statusMap = {
      awaiting_deposit: 'รอชำระมัดจำ',
      deposit_paid: 'ชำระมัดจำแล้ว',
      scheduled: 'รอดำเนินการ',
      in_progress: 'กำลังเนิดการซ่อมแซม',
      completed: 'ดำเนินการเสร็จสิ้น',
      cancelled_by_user: 'ยกเลิกโดยผู้ใช้',
      cancelled_by_system: 'ยกเลิกโดยระบบ',
      no_show: 'ช่างไม่พร้อมให้บริการตามนัด',
      pending: 'รอการยืนยัน',
      need_reschedule: 'กรุณาเลือกวัน-เวลาใหม่ เนื่องจากช่างไม่พร้อมให้บริการ'
    };

    //  ฟอร์แมตข้อมูลพร้อมส่งกลับ
    const booking = {
      id: b.id,
      service_name: b.service_name || '-',
      point_count: b.point_count || 0,

      //  ผู้ใช้บริการ
      customer_name: b.user_first_name && b.user_last_name
        ? `${b.user_first_name} ${b.user_last_name}` : '-',
      
      
      phone: b.user_phone || '-',

      house_number: b.house_number,
      road: b.road,
      suburb: b.suburb,
      district: b.district,
      city: b.city,
      postcode: b.postcode,
      latitude: b.latitude,
      longitude: b.longitude,

      //  ข้อมูลงาน
      booking_date: b.booking_date,
      booking_time: b.booking_time,
      deposit_amount_fmt: b.deposit_amount
      
        ? Number(b.deposit_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-',
      total_amount_fmt: b.total_amount
        ? Number(b.total_amount).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-',
      total_price_fmt: b.total_price
        ? Number(b.total_price).toLocaleString('th-TH', { minimumFractionDigits: 2 }) : '-',
      status_text: statusMap[b.status] || b.status || '-',

      //  ข้อมูลช่าง
      technician_name: b.tech_first_name && b.tech_last_name
        ? `${b.tech_prefix || ''}${b.tech_first_name} ${b.tech_last_name}` : '-',
      
        tech_phone: b.tech_phone || '-'
    };

    //  ส่งข้อมูลให้ frontend
    res.json(booking);

  } catch (err) {
    console.error('Error fetching booking details:', err);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการโหลดข้อมูล' });
  }
});





module.exports = router;