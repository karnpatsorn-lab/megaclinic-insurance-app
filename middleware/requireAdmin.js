module.exports = function requireAdmin(req, res, next) {
  if (req.session && req.session.adminUser) {
    return next();
  }
  return res.status(401).json({ error: 'ต้องเข้าสู่ระบบก่อนใช้งานส่วนนี้' });
};
