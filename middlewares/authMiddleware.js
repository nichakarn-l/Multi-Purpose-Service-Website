function isLoggedIn(req, res, next) {
  const user = req.session.user || req.user;

  if (user && user.role === 'user') {
    return next();
  }

  res.redirect('/login');
}
module.exports = { isLoggedIn };
