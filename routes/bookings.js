const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { isLoggedIn } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');
const pool = require('../db');
const moment = require('moment');
const { companyLocation } = require('../config/companyLocation');


// รีวิวบริการแต่ละบริการ
async function getReviewsByServiceId(serviceId) {
  const result = await pool.query(
    `SELECT r.*, up.first_name, up.last_name 
     FROM reviews r
     JOIN bookings b ON r.booking_id = b.id
     JOIN users u ON r.user_id = u.id
     LEFT JOIN user_profiles up ON u.id = up.user_id
     WHERE b.service_id = $1
     ORDER BY r.review_date DESC`,
    [serviceId]
  );
  return result.rows;
}

// รีวิว ดาวเฉลี่ย
async function getReviewStatsByServiceId(serviceId) {
  const result = await pool.query(`
    SELECT 
      COUNT(*) AS total_reviews,
      ROUND(AVG(rating), 1) AS avg_rating,
      SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS star5,
      SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS star4,
      SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS star3,
      SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS star2,
      SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS star1
    FROM reviews r
    JOIN bookings b ON r.booking_id = b.id
    WHERE b.service_id = $1
  `, [serviceId]);

  return result.rows[0];
}

// หน้าดูรายละเอียดบริการ
router.get('/service/:id', async (req, res) => {
  const serviceId = req.params.id;

  try {
    const result = await pool.query('SELECT * FROM services WHERE id = $1', [serviceId]);

    if (result.rows.length === 0) {
      return res.send('ไม่พบข้อมูลบริการนี้');
    }
    const service = result.rows[0];

    const categoryResult = await pool.query(
      'SELECT name FROM service_categories WHERE id = $1',
      [service.service_category_id]
    );
    const categoryName = categoryResult.rows[0]?.name || 'ไม่พบหมวดหมู่';
    const reviews = await getReviewsByServiceId(serviceId);
    const stats = await getReviewStatsByServiceId(serviceId);

    res.render('service-detail', {
      service,
      categoryId: service.service_category_id,
      categoryName,
      reviews,
      stats,
      user: req.session.user || null
    });
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});



// เวลา (ใช้ได้ทั้งจองปกติและเลื่อนเฉพาะช่าง)
router.get('/available-times', async (req, res) => {
  const { date, service_id, technician_id, exclude_booking_id } = req.query;

  if (!date || !service_id)
    return res.status(400).json({ error: 'Missing date or service_id' });

  try {

    const serviceResult = await pool.query(
      'SELECT duration FROM services WHERE id = $1',
      [service_id]
    );
    if (serviceResult.rows.length === 0)
      return res.status(404).json({ error: 'Service not found' });

    const service = serviceResult.rows[0];

    //  แปลง duration เป็นนาที
    let serviceDuration = 0;
    const dur = service.duration;

    if (typeof dur === 'object' && dur.hours !== undefined) {
      serviceDuration =
        (parseInt(dur.hours,10)||0)*60 +
        (parseInt(dur.minutes,10)||0);
    } else {
      serviceDuration = parseInt(dur,10) || 0;
    }

    //  เลือกช่าง
    let technicianIds = [];

    if (technician_id) {
      technicianIds = [parseInt(technician_id)];
    } else {
      const techs = await pool.query(
        `SELECT t.id
         FROM technicians t
         JOIN technician_services ts
           ON t.id = ts.technician_id
         WHERE ts.service_id = $1
           AND t.status = 'active'`,
        [service_id]
      );

      technicianIds = techs.rows.map(t => t.id);
    }

    if (technicianIds.length === 0)
      return res.json([]);

    const totalTechCount = technicianIds.length;

    // ดึง booking ทั้งหมดของวันนั้น
    const queryParams = [date, technicianIds];
    let queryText = `
      SELECT b.id,
             b.technician_id,
             b.booking_time,
             s.duration AS service_duration,
             b.point_count
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      WHERE b.booking_date = $1
        AND b.technician_id = ANY($2::int[])
        AND b.status IN (
              'awaiting_deposit',
              'deposit_paid',
              'scheduled',
              'in_progress'
            )
    `;

    if (exclude_booking_id) {
      queryText += ` AND b.id <> $3`;
      queryParams.push(parseInt(exclude_booking_id));
    }

    const bookings = await pool.query(queryText, queryParams);

    // เก็บช่วงเวลาที่ไม่ว่าง
    const unavailable = {};

    for (const b of bookings.rows) {

      const timeStr = b.booking_time.slice(0,5);
      const start = moment(`${date} ${timeStr}`, 'YYYY-MM-DD HH:mm');

      let minutes = 0;
      const dur = b.service_duration;
      const pointsB = b.point_count || 1;

      if (typeof dur === 'object' && dur.hours !== undefined) {
        minutes =
          ((parseInt(dur.hours,10)||0)*60 +
           (parseInt(dur.minutes,10)||0)) * pointsB;
      } else {
        minutes = (parseInt(dur,10)||0) * pointsB;
      }

      const end = start.clone().add(minutes, 'minutes');

      if (!unavailable[b.technician_id])
        unavailable[b.technician_id] = [];

      unavailable[b.technician_id].push({ start, end });
    }

    // ดึง booking เดิม (สำหรับเช็คเวลาเดิม)
    let originalBooking = null;

    //เลื่อนงาน
    if (exclude_booking_id) {
      const originalRes = await pool.query(
        `SELECT booking_date::text, booking_time::text
         FROM bookings WHERE id = $1`,
        [exclude_booking_id]
      );

      if (originalRes.rows.length) {
        originalBooking = originalRes.rows[0];
      }
    }

    // สร้างช่วงเวลา
    const allTimes =
      ["09:00","10:00","11:00","13:00","14:00","15:00","16:00","17:00"];

    const result = [];

    for (const timeStr of allTimes) {

      const timeMoment =
        moment(`${date} ${timeStr}`, 'YYYY-MM-DD HH:mm');

      const serviceEnd =
        timeMoment.clone().add(serviceDuration, 'minutes');

      const isAnyTechAvailable =
        technicianIds.some(techId => {

          const techBusy = unavailable[techId] || [];

          return !techBusy.some(({ start, end }) =>
            timeMoment.isBefore(end) &&
            serviceEnd.isAfter(start)
          );
        });

      let isBooked = !isAnyTechAvailable;

      // ล็อคเวลาเดิม เฉพาะกรณีเลื่อน + มีช่างคนเดียว
      if (
        exclude_booking_id &&
        totalTechCount === 1 &&
        originalBooking &&
        originalBooking.booking_date === date &&
        originalBooking.booking_time.slice(0,5) === timeStr
      ) {
        isBooked = true;
      }

      result.push({
        time: timeStr,
        booked: isBooked
      });
    }

    res.json(result);

  } catch (error) {
    console.error('Error in /available-times:', error);
    res.status(500).json({ error: 'Server error' });
  }
});




// หน้า booking
router.get('/booking/:serviceId', isLoggedIn, async (req, res) => {
  const serviceId = req.params.serviceId;
  const bookingId = req.query.bookingId;
  try {
    // ดึงข้อมูล service
    const serviceResult = await pool.query(
      'SELECT * FROM services WHERE id = $1',
      [serviceId]
    );
    //ตรวจสอบว่าพบบริการหรือไม่
    if (serviceResult.rows.length === 0) {
      return res.send('ไม่พบข้อมูลบริการนี้');
    }

    const service = serviceResult.rows[0];

    //ดึง id ของหมวดหมู่บริการ
    const categoryId = service.service_category_id;

    //ดึงชื่อหมวดหมู่บริการ service_categories
    let categoryName = '';
    if (categoryId) {
      const categoryResult = await pool.query(
        'SELECT name FROM service_categories WHERE id = $1',
        [categoryId]
      );
      categoryName = categoryResult.rows.length > 0 ? categoryResult.rows[0].name : 'ไม่พบหมวดหมู่';
    }

    // ดึง options
    const optionsResult = await pool.query(
      `SELECT * FROM service_options WHERE service_id = $1 ORDER BY id`,
      [serviceId]
    );

    // ตรวจสอบว่ามี bookingId มั้ย
    let booking = null;
    if (bookingId) {
      const bookingResult = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
      
      if (bookingResult.rows.length > 0) {
        const rawBooking = bookingResult.rows[0];
        const dateObj = new Date(rawBooking.booking_date);

        booking = {
          ...rawBooking,
          booking_date: dateObj.toLocaleDateString('sv-SE'),
          booking_time: rawBooking.booking_time.slice(0, 5)
        };
      }
    }

    // เช็คว่ามีช่าง active ที่ทำบริการนี้ได้หรือไม่
    const techRes = await pool.query(`
      SELECT t.id 
      FROM technicians t
      JOIN technician_services ts ON t.id = ts.technician_id
      WHERE ts.service_id = $1
        AND t.status = 'active'
    `, [serviceId]);

    const canBook = techRes.rows.length > 0;  // true = จองได้, false = ไม่มีช่าง active


    // ส่ง categoryId, categoryName ให้ view
    res.render('booking', {
      service,
      options: optionsResult.rows,
      user: req.session.user || null,
      booking,
      currentStep: 1,
      categoryId,
      categoryName,
      canBook   // ส่งค่าเพื่อใช้ปิด UI
    });

  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


// บันทึกการจองใหม่
router.post('/booking', isLoggedIn, async (req, res) => {
  // รับข้อมูลจากแบบฟอร์ม
  const { service_id, booking_date, booking_time, point_count } = req.body;
  //ดึง user id จาก session
  const userId = req.session.user?.id;

  //ตรวจสอบว่าผู้ใช้ล็อกอินมั้ย
  if (!userId) {
    return res.redirect('/login');
  }

  try {
    //ดึง options ของ service
    const optionsResult = await pool.query(
      'SELECT * FROM service_options WHERE service_id = $1 ORDER BY id',
      [service_id]
    );
    const options = optionsResult.rows;

    //คำนวณราคา
    let calculatedPrice = 0;
    const count = parseInt(point_count) || 1;

    if (options.length === 0) {
      const serviceResult = await pool.query('SELECT base_price FROM services WHERE id = $1', [service_id]);
      if (serviceResult.rows.length > 0) {
        calculatedPrice = count * parseFloat(serviceResult.rows[0].base_price);

      }
    } else if (options.length === 1) {
      calculatedPrice = count * parseFloat(options[0].option_price);

    } else if (options.length >= 2) {
      const firstPointPrice = parseFloat(options[0].option_price);
      const additionalPointPrice = parseFloat(options[1].option_price);

      if (firstPointPrice === additionalPointPrice) {
        // ราคาต่อจุดเท่ากัน คูณจำนวนจุด
        calculatedPrice = count * firstPointPrice;
      } else {
        // ราคาต่างกัน คำนวณแบบจุดแรก + จุดถัดไป * (จำนวนจุด - 1)
        calculatedPrice = firstPointPrice + (count - 1) * additionalPointPrice;
      }
    }

    // ดึงระยะเวลาบริการ
    const serviceInfo = await pool.query(
      `SELECT duration FROM services WHERE id = $1`,
      [service_id]
    );

    const duration = serviceInfo.rows[0].duration;

    // จองบริการใหม่หาช่างว่าง ปรับให้สมดุลในเลือกช่างที่มีงานรวมกันน้อยสุด
    const techRes = await pool.query(`
      SELECT t.id,
      (
        SELECT COUNT(*)
        FROM bookings b
        WHERE b.technician_id = t.id
        AND b.status NOT IN (
              'completed',
              'cancelled_by_user',
              'cancelled_by_system'
            )
      ) AS total_jobs

      FROM technicians t
      JOIN technician_services ts ON t.id = ts.technician_id

      WHERE ts.service_id = $1
      AND t.status = 'active'

      AND NOT EXISTS (
        SELECT 1
        FROM bookings b2
        JOIN services s2 ON b2.service_id = s2.id
        WHERE b2.technician_id = t.id
          AND b2.booking_date = $2
          AND b2.status IN (
              'awaiting_deposit',
              'deposit_paid',
              'scheduled',
              'in_progress'
            )
          AND (
            $3::time < (b2.booking_time + s2.duration)
            AND
            ($3::time + $4::interval) > b2.booking_time
          )
      )

      ORDER BY total_jobs ASC
      LIMIT 1
      `, [service_id, booking_date, booking_time, duration]);
    
    //ตรวจสอบว่ามีช่างว่างหรือไม่
    if (techRes.rows.length === 0) {
      return res.send('ไม่มีช่างว่างในวันและเวลานี้ กรุณาเลือกใหม่');
    }

    //เก็บ technician id
    const technicianId = techRes.rows[0].id;

    // บันทึกการจองโดยเพิ่ม technician_id และใช้ราคาที่คำนวณเอง
    const result = await pool.query(
      `INSERT INTO bookings (user_id, service_id, technician_id, booking_date, booking_time, point_count, final_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [userId, service_id, technicianId, booking_date, booking_time, count, calculatedPrice]
    );

    const bookingId = result.rows[0].id;
    res.redirect(`/booking_summary/${bookingId}`);

  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});



// อัปเดตการจอง (edit)
router.post('/booking/edit/:id', isLoggedIn, async (req, res) => {
  const bookingId = req.params.id;
  const { booking_date, booking_time, point_count, final_price } = req.body;

  try {
    await pool.query(
      `UPDATE bookings 
       SET booking_date = $1, booking_time = $2, point_count = $3, final_price = $4
       WHERE id = $5`,
      [booking_date, booking_time, point_count, final_price, bookingId]
    );

    res.redirect(`/booking_summary/${bookingId}`);

  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// ยกเลิกการจอง (ลบออก)
router.get('/cancel-booking/:bookingId', isLoggedIn, async (req, res) => {
  const bookingId = req.params.bookingId;
  try {
    // ดึง service_category_id ผ่าน service_id
    const result = await pool.query(
      `SELECT s.service_category_id
       FROM bookings b
       JOIN services s ON b.service_id = s.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.send('ไม่พบข้อมูลการจองนี้');
    }

    const categoryId = result.rows[0].service_category_id;

    // ลบการจองออก
    await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

    // redirect กลับไปยังหน้าหมวดหมู่บริการ
    res.redirect(`/services/${categoryId}`);
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


// หน้า booking_summary
router.get('/booking_summary/:bookingId', isLoggedIn, async (req, res) => {
  //รับค่า bookingId มาจาก url
  const bookingId = req.params.bookingId;

  try {
    //ดึงข้อมูลการจองจากฐานข้อมูล
    const result = await pool.query(`
      SELECT 
        b.id AS booking_id,
        b.booking_date,
        b.booking_time,
        b.point_count,
        b.final_price,
        b.total_price,
        s.id AS service_id,
        s.name AS service_name,
        s.base_price,
        s.service_category_id,
        s.service_area,
        up.first_name AS user_first_name,
        up.last_name AS user_last_name,
        up.phone AS user_phone,
        u.email AS user_email,
        up.address AS user_address,
        up.house_number AS user_house_number,
        up.road AS user_road,
        up.suburb AS user_suburb,
        up.district AS user_district,
        up.city AS user_city,
        up.postcode AS user_postcode,
        up.latitude AS user_latitude,
        up.longitude AS user_longitude
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      LEFT JOIN user_profiles up ON up.user_id = b.user_id
      LEFT JOIN users u ON u.id = b.user_id
      WHERE b.id = $1
    `, [bookingId]);

    if (result.rows.length === 0) return res.send('ไม่พบข้อมูลการจองนี้');
    //เก็บข้อมูลการจอง
    const bookingData = result.rows[0];

    //กำหนดตำแหน่งต้นทาง
    const origin = { lat: companyLocation.latitude, lng: companyLocation.longitude };
    const destination = { lat: bookingData.user_latitude, lng: bookingData.user_longitude };

    // --- ฟังก์ชันคำนวณระยะทาง ---
    function getDistanceKm(origin, destination) {
      if (!destination.lat || !destination.lng) return 0;
      const R = 6371;
      const dLat = (destination.lat - origin.lat) * Math.PI / 180;
      const dLng = (destination.lng - origin.lng) * Math.PI / 180;
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(origin.lat * Math.PI / 180) *
        Math.cos(destination.lat * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }


    // --- ฟังก์ชันคำนวณระยะทาง ---
    function calculateTravelFee(distanceKm) {
      let travelFee = 0;
      if (distanceKm <= 10) travelFee = 0;
      else if (distanceKm <= 20) travelFee = (distanceKm - 10) * 10;
      else if (distanceKm <= 30) travelFee = 10 * 10 + (distanceKm - 20) * 12;
      else travelFee = 10 * 10 + 10 * 12 + (distanceKm - 30) * 15;
      return travelFee;
    }

    const distanceKmRaw = getDistanceKm(origin, destination);
    const distanceKm = Math.ceil(distanceKmRaw);
    const travelFee = calculateTravelFee(distanceKm);

    let categoryName = '';
    if (bookingData.service_category_id) {
      const categoryResult = await pool.query(
        'SELECT name FROM service_categories WHERE id = $1',
        [bookingData.service_category_id]
      );
      categoryName = categoryResult.rows.length > 0 ? categoryResult.rows[0].name : 'ไม่พบหมวดหมู่';
    }

    //คำนวณราคารวม ค่าบริการ+ต่าเดินทาง
    const totalFee = parseFloat(bookingData.final_price) + travelFee; // แสดงผลเท่านั้น

    res.render('booking_summary', {
      service: { name: bookingData.service_name, base_price: bookingData.base_price },
      booking: bookingData, // final_price = ราคาบริการจริง
      categoryName,
      travel: { origin, distanceKm, fee: travelFee },
      totalFee, // สำหรับแสดงรวมทั้งหมด
      currentStep: 2
    });

  } catch (err) {
    console.error(err);
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

router.post('/booking_summary/:bookingId', isLoggedIn, async (req, res) => { 
  const bookingId = req.params.bookingId;
  //รับข้อมูลจากฟอร์ม
  const {
    first_name,
    last_name,
    phone,
    latitude,
    longitude,
    house_number,
    road,
    suburb,
    district,
    city,
    postcode,
    address,
    total_price
  } = req.body;

  try {
    // อัปเดต user_profiles พร้อม first_name, last_name, phone
    await pool.query(`
      UPDATE user_profiles
      SET first_name = $1,
          last_name = $2,
          phone = $3,
          latitude = $4,
          longitude = $5,
          house_number = $6,
          road = $7,
          suburb = $8,
          district = $9,
          city = $10,
          postcode = $11,
          address = $12
      WHERE user_id = (
        SELECT user_id FROM bookings WHERE id = $13
      )
    `, [
      first_name,
      last_name,
      phone,
      latitude,
      longitude,
      house_number,
      road,
      suburb,
      district,
      city,
      postcode,
      address,
      bookingId
    ]);

    // อัปเดตราคารวม total_price ลง bookings
    if(total_price) {
      await pool.query(`
        UPDATE bookings
        SET total_price = $1
        WHERE id = $2
      `, [total_price, bookingId]);
    }

    res.redirect(`/booking_summary/${bookingId}`);
  } catch (err) {
    console.error(err);
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


// อัปเดต total_price ก่อนเข้าสู่หน้าชำระเงิน
router.post('/payment/:bookingId', isLoggedIn, async (req, res) => {
  const bookingId = req.params.bookingId;
  const { total_price } = req.body;

  try {
    //ตรวจสอบว่ามีราคารวมส่งมามั้ย
    if (!total_price) {
      return res.status(400).send('ไม่พบค่ารวมทั้งหมด (total_price)');
    }

    //อัปเดตราคารวมในฐานข้อมูล
    await pool.query(
      `UPDATE bookings 
       SET total_price = $1
       WHERE id = $2`,
      [total_price, bookingId]
    );

    // ไปหน้าชำระเงิน
    res.redirect(`/payment/${bookingId}`);
  } catch (err) {
    console.error('Error updating total_price:', err);
    res.status(500).send('เกิดข้อผิดพลาดในการอัปเดตราคารวม');
  }
});


// หน้า payment
router.get('/payment/:bookingId', isLoggedIn, async (req, res) => {
  const bookingId = req.params.bookingId;
  const result = await pool.query(
    `SELECT b.*, s.base_price, s.name AS service_name,
      (b.total_price * 0.2)::numeric(10,2) AS deposit_amount
     FROM bookings b
     JOIN services s ON b.service_id = s.id
     WHERE b.id = $1`,
    [bookingId]
  );

  if (result.rows.length === 0) {
    return res.send('ไม่พบข้อมูลการจองนี้');
  }

  res.render('payment', { 
    booking: result.rows[0],
    currentStep: 3 
  });
});


// บันทึกการชำระเงิน
router.post('/payment', upload.single('slip_image_path'), async (req, res) => {
  const { booking_id, amount, payment_method } = req.body;
  const slipImagePath = req.file ? '/uploads/' + req.file.filename : null;

  if (!amount) {
    return res.send('ต้องระบุยอดชำระ');
  }

  try {
    await pool.query(
      `INSERT INTO payments (booking_id, amount, payment_method, slip_image_path)
       VALUES ($1, $2, $3, $4)`,
      [booking_id, amount, payment_method, slipImagePath]
    );

    // อัปเดตสถานะการจองเป็น "ชำระมัดจำแล้ว" คำนวณเงินมัดจำ
    await pool.query(
      `UPDATE bookings
       SET status = 'deposit_paid',
           deposit_amount = total_price * 0.2,
           total_amount = total_price - (total_price * 0.2)
       WHERE id = $1`,
      [booking_id]
    );


    res.redirect('/my-bookings');
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


// หน้า my-bookings
router.get('/my-bookings', isLoggedIn, async (req, res) => {
  const userId = req.session.user.id;

  try {
    //ดึงข้อมูลการจองจากฐานข้อมูล เรียงจากวันล่าสุด > ไปวันเก่า
    const result = await pool.query(
      `SELECT 
        b.*, 
        s.name AS service_name,
        br.reason AS reschedule_reason,
        br.note AS reschedule_note,
        br.created_at AS reschedule_created_at,
        COALESCE((SELECT COUNT(*) FROM reviews r WHERE r.booking_id = b.id AND r.user_id = $1), 0) AS review_count
      FROM bookings b
      JOIN services s ON b.service_id = s.id
      LEFT JOIN booking_reschedules br ON br.booking_id = b.id
      WHERE b.user_id = $1
      ORDER BY b.booking_date DESC`,
      [userId]
    );

    const bookings = result.rows.map(b => {
      let statusText = '';
      switch (b.status) {
        case 'awaiting_deposit': statusText = 'รอชำระมัดจำ'; break;
        case 'deposit_paid': statusText = 'ชำระมัดจำแล้ว'; break;
        case 'scheduled': statusText = 'รอดำเนินการ'; break;
        case 'in_progress': statusText = 'กำลังเนินการซ่อมแซม'; break;
        case 'completed': statusText = 'ดำเนินการเสร็จสิ้น'; break;
        case 'cancelled_by_user': statusText = 'ยกเลิกโดยผู้ใช้'; break;
        case 'cancelled_by_system': statusText = 'ยกเลิกโดยระบบ'; break;
        case 'no_show': statusText = 'ช่างไม่พร้อมให้บริการตามนัด'; break;
        case 'need_reschedule': statusText = 'กรุณาเลือกวัน-เวลาใหม่'; break;
        default: statusText = '-';
      }

      const reasonMap = {
        personal: 'ติดภารกิจเร่งด่วน',
        emergency: 'เหตุสุดวิสัย / เหตุฉุกเฉิน'
      };

      //คำนวณยอดเงินคงเหลือ
      const remainingAmount = b.total_amount ?? ((b.total_price || 0) - (b.deposit_amount || 0));

      return {
        ...b,
        statusText,
        remainingAmount,
        hasReview: b.review_count > 0, //ตรวจสอบว่ารีวิวแล้วหรือยัง
        rescheduleReasonText: reasonMap[b.reschedule_reason] || null
      };
    });

    res.render('my-bookings', { bookings });
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


//หน้าbooking-detail
router.get('/booking-detail/:id', isLoggedIn, async (req, res) => {
    const { id } = req.params;

    if (!id || isNaN(id)) {
        return res.status(400).send('ID ไม่ถูกต้อง');
    }

    try {
      //ดึงข้อมูลการจองจากฐานข้อมูล
        const result = await pool.query(`
            SELECT 
                b.*, 
                s.name AS service_name,
                up.first_name AS user_first_name,
                up.last_name AS user_last_name,
                up.phone AS user_phone,
                t.first_name AS tech_first_name,
                t.last_name AS tech_last_name,
                t.phone AS tech_phone
            FROM bookings b
            JOIN services s ON b.service_id = s.id
            JOIN user_profiles up ON b.user_id = up.user_id
            LEFT JOIN technicians t ON b.technician_id = t.id
            WHERE b.id = $1
        `, [id]);

        const booking = result.rows[0];

        if (!booking) {
            return res.status(404).send('ไม่พบข้อมูลการจอง');
        }

        // สร้างชื่อเต็มผู้จองและช่าง
        booking.user_fullname = `${booking.user_first_name} ${booking.user_last_name}`;
        booking.tech_fullname = booking.tech_first_name 
            ? `${booking.tech_first_name} ${booking.tech_last_name}`
            : 'ยังไม่ได้กำหนดช่าง';

      // แปลงสถานะเป็นข้อความภาษาไทย
      let statusText;
      switch (booking.status) {
          case 'awaiting_deposit': statusText = 'รอชำระมัดจำ'; break;
          case 'deposit_paid': statusText = 'ชำระมัดจำแล้ว'; break;
          case 'scheduled': statusText = 'รอดำเนินการ'; break;
          case 'in_progress': statusText = 'กำลังเนินการซ่อมแซม'; break;
          case 'completed': statusText = 'ดำเนินการเสร็จสิ้น'; break;
          case 'cancelled_by_user': statusText = 'ยกเลิกโดยผู้ใช้'; break;
          case 'cancelled_by_system': statusText = 'ยกเลิกโดยระบบ'; break;
          case 'no_show': statusText = 'ช่างไม่พร้อมให้บริการตามนัด'; break;
          case 'need_reschedule': statusText = 'กรุณาเลือกวัน-เวลาใหม่'; break;
          default: statusText = '-';
      }
      booking.status_text = statusText;

      //จำนวนการเลื่อน
      const MAX_RESCHEDULE = 1;

      // ตัดเวลาออก เหลือแค่ "วัน"
      const today = new Date(); //วันปัจจุบัน
      today.setHours(0, 0, 0, 0);

      const bookingDate = new Date(booking.booking_date); //วันนัด
      bookingDate.setHours(0, 0, 0, 0);



      // เลื่อนได้เฉพาะกรณี "วันนัดมากกว่าวันนี้" และกดได้ 1 ครั้ง
      const canReschedule = bookingDate > today &&
      booking.reschedule_count < MAX_RESCHEDULE && 
        !['in_progress',
          'completed',
          'cancelled_by_user',
          'cancelled_by_system',
          'no_show',
          'need_reschedule']
          .includes(booking.status);
      

        res.render('booking-detail', {
          booking,
          canReschedule
        });


    } catch (err) {
        console.error('ERROR in /booking-detail/:id', err);
        res.status(500).send('เกิดข้อผิดพลาดภายในระบบ: ' + err.message);
    }
});


//  ย้อนกลับจาก booking_summary (ลบ booking ชั่วคราว)
router.get('/cancel-temp-booking/:bookingId', isLoggedIn, async (req, res) => {
  const bookingId = req.params.bookingId;

  try {
    // ดึงข้อมูล service_id ก่อนลบ
    const result = await pool.query(
      'SELECT service_id FROM bookings WHERE id = $1',
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.redirect('/services'); // ถ้าไม่มีข้อมูลก็กลับหน้า service ไปเลย
    }

    const serviceId = result.rows[0].service_id;

    // ลบการจองออก (เพราะยังไม่ยืนยัน)
    await pool.query('DELETE FROM bookings WHERE id = $1', [bookingId]);

    // กลับไปหน้า booking ของ service เดิม
    res.redirect(`/booking/${serviceId}`);
  } catch (err) {
    console.error(err);
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


router.post('/customer/reschedule', async (req, res) => {

  const { booking_id, new_date, new_time } = req.body;

  try {

    if (!booking_id || !new_date || !new_time) {
      return res.json({ success: false, error: 'Missing data' });
    }

    //  ดึงข้อมูล booking เดิม
    const bookingRes = await pool.query(
      `SELECT 
         service_id,
         technician_id,
         booking_date::text,
         booking_time::text,
         reschedule_count
       FROM bookings
       WHERE id = $1`,
      [booking_id]
    );

    if (!bookingRes.rows.length) {
      return res.json({ success: false, error: 'Booking not found' });
    }

    const booking = bookingRes.rows[0];

    //เลื่อน 1 ครั้ง
    const MAX_RESCHEDULE = 1;

    if (booking.reschedule_count >= MAX_RESCHEDULE) {
      return res.json({
        success: false,
        error: 'คุณได้ใช้สิทธิ์เลื่อนครบแล้ว'
      });
    }

    const serviceId = booking.service_id;
    const originalTechnicianId = booking.technician_id;

    // แปลงเวลาให้เป็น HH:mm:ss
    const fixedTime = new_time.length === 5 ? new_time + ":00" : new_time;

    // ดึง duration ของ service
    const serviceRes = await pool.query(
      `SELECT duration FROM services WHERE id = $1`,
      [serviceId]
    );

    const duration = serviceRes.rows[0].duration;

    //  เช็คว่าเป็นวันเวลาเดิมไหม
    const isSameDateTime =
      booking.booking_date === new_date &&
      booking.booking_time.slice(0,5) === fixedTime.slice(0,5);

    let newTechnicianId;

    //1 เลือกเวลาเดิม
    //  ตรวจสอบว่าเลือกวันเวลาเดิมมั้ย
    if (isSameDateTime) {

      const techRes = await pool.query(`
        SELECT t.id,
               COUNT(b2.id) AS total_jobs
        FROM technicians t
        JOIN technician_services ts ON ts.technician_id = t.id
        LEFT JOIN bookings b2
          ON b2.technician_id = t.id
          AND b2.status NOT IN (
            'completed',
            'cancelled_by_user',
            'cancelled_by_system'
            )
        WHERE ts.service_id = $1
        AND t.status = 'active'
        AND t.id <> $2
        AND t.id NOT IN (
            SELECT b.technician_id
            FROM bookings b
            JOIN services s ON b.service_id = s.id
            WHERE b.booking_date = $3
            AND (
              $4::time < (b.booking_time + s.duration)
              AND
              ($4::time + $6::interval) > b.booking_time
            )
            AND b.id <> $5
        )
        GROUP BY t.id
        ORDER BY total_jobs ASC
        LIMIT 1
      `, [
          serviceId,
          originalTechnicianId,
          new_date,
          fixedTime,
          booking_id,
          duration
          ]);

      if (!techRes.rows.length) {
        return res.json({
          success: false,
          error: 'ไม่มีช่างว่างในเวลานี้'
        });
      }

      newTechnicianId = techRes.rows[0].id;
    
    //2 เลือกวันเวลาใหม่
    } else {

      //  เช็คว่าช่างเดิมว่างไหม
      const originalTechCheck = await pool.query(`
        SELECT 1
          FROM bookings b
          JOIN services s ON b.service_id = s.id
          WHERE b.technician_id = $1
          AND b.booking_date = $2
          AND b.status IN (
            'awaiting_deposit',
            'deposit_paid',
            'scheduled',
            'in_progress'
          )
          AND (
            $3::time < (b.booking_time + s.duration)
            AND
            ($3::time + $5::interval) > b.booking_time
          )
          AND b.id <> $4
      `, [originalTechnicianId, new_date, fixedTime, booking_id, duration]);

      // ถ้าว่าง → ใช้ช่างเดิม
      if (originalTechCheck.rows.length === 0) {
        newTechnicianId = originalTechnicianId;

      } else {

        // หา "ช่างที่ว่าง" และงานน้อยที่สุด
        const techRes = await pool.query(`
          SELECT t.id,
                 COUNT(b2.id) AS total_jobs
          FROM technicians t
          JOIN technician_services ts ON ts.technician_id = t.id
          LEFT JOIN bookings b2
            ON b2.technician_id = t.id
            AND b2.status NOT IN (
              'completed',
              'cancelled_by_user',
              'cancelled_by_system'
            )
          WHERE ts.service_id = $1
          AND t.status = 'active'
          AND t.id NOT IN (
              SELECT b.technician_id
              FROM bookings b
              JOIN services s ON b.service_id = s.id
              WHERE b.booking_date = $2
              AND b.status IN (
                'awaiting_deposit',
                'deposit_paid',
                'scheduled',
                'in_progress'
              )
              AND (
                $3::time < (b.booking_time + s.duration)
                AND
                ($3::time + $5::interval) > b.booking_time
              )
              AND b.id <> $4
          )
          GROUP BY t.id
          ORDER BY total_jobs ASC
          LIMIT 1
        `, [serviceId, new_date, fixedTime, booking_id, duration]);

        if (!techRes.rows.length) {
          return res.json({
            success: false,
            error: 'ไม่มีช่างว่างในเวลานี้'
          });
        }

        newTechnicianId = techRes.rows[0].id;
      }
    }

    //  อัปเดต booking นับการกดเลื่อนวันเวลา
    await pool.query(
      `UPDATE bookings
       SET booking_date = $1,
           booking_time = $2,
           technician_id = $3,
           status = 'scheduled',
           reschedule_count = reschedule_count + 1
       WHERE id = $4`,
      [new_date, fixedTime, newTechnicianId, booking_id]
    );

    // ลบคำขอเลื่อนที่ค้างอยู่ (เพราะดำเนินการสำเร็จแล้ว)
    await pool.query(
      `DELETE FROM booking_reschedules
      WHERE booking_id = $1`,
      [booking_id]
    );


    res.json({ success: true });

  } catch (err) {
    console.error("Reschedule ERROR:", err);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});




module.exports = router;

