const express = require('express');
const router = express.Router();
const pool = require('../db'); 
const { isLoggedIn } = require('../middlewares/authMiddleware');
const bcrypt = require('bcrypt');


// หน้าบริการในหมวดนี้
router.get('/services/:categoryId', async (req, res) => {
  const categoryId = req.params.categoryId;
  try {
    const result = await pool.query(
      'SELECT * FROM services WHERE service_category_id = $1 AND is_active = true',
      [categoryId]
    );
    const categoryResult = await pool.query(
      'SELECT name FROM service_categories WHERE id = $1',
      [categoryId]
    );

    const categoryName = categoryResult.rows[0]?.name || 'ไม่พบหมวดหมู่';

    res.render('services', {
      services: result.rows,
      categoryName: categoryName,
      categoryId: categoryId,
      user: req.session.user || null
    });
  } catch (err) {
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});

// GET /service?search=คำค้น
router.get('/service', async (req, res) => {
  try {
    const search = req.query.search || '';

    let sql = `
      SELECT s.*, c.name AS category_name
      FROM services s
      JOIN service_categories c 
        ON c.id = s.service_category_id
      WHERE s.is_active = true 
        AND c.is_active = true
    `;

    const params = [];

    if (search) {
      sql += ' AND s.name ILIKE $1';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY s.id';

    const result = await pool.query(sql, params);

    res.render('services', {
      services: result.rows,
      categoryName: search ? `ค้นหา: "${search}"` : 'บริการทั้งหมด',
      categoryId: null,
      user: req.session.user || null
    });

  } catch (err) {
    console.error(err);
    res.send('เกิดข้อผิดพลาด: ' + err.message);
  }
});


module.exports = router;