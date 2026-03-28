function isTechnicianLoggedIn(req, res, next) {
  console.log('session user:', req.session.user);
  if (req.session.user && req.session.user.role === 'technician') {
    return next();
  }
  res.redirect('/technician/login');
}
module.exports = { isTechnicianLoggedIn };