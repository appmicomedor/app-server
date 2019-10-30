const jwt = require('jwt-simple');
const moment = require('moment');

class Secure {

  constructor(token) {
    this.token = token;
  }

  createToken(user) {
    var sub = user.id;
    for (var i = 0; i < user.childs.length; i++) {
      sub += '|' + user.childs[i].id;
    }

    var payload = {
      sub: sub,
      iat: moment().unix(),
      exp: moment().add(14, "days").unix(),
    };
    return jwt.encode(payload, this.token);
  };
  
  ensureAuthenticated(req, res, id) {
    try {
      if(!req.headers.authorization) {
        return 1;
      }
      
      var token = req.headers.authorization.split(" ")[1];
      var payload = jwt.decode(token, this.token);
      
      if(payload.exp <= moment().unix()) {
        return null;
      }
      
      if (!payload.sub || payload.sub.length==0) {
        return null;
      }

      var ids = payload.sub.split('|');
      for (var i = 0; i < ids.length; i++) {
        if (ids[i]==id){
          return id;
        }
      }
    }
    catch (e) {
      console.log('ERROR ensureAuthenticated ' + e);
    }    

    return null;
  }

  odooConfigCatering(companyId) {

    let config = {
      url: process.env['ODOO_URL'],
      port: process.env['ODOO_PORT'],
      db: process.env['ODOO_DB'],
      username: '',
      password: process.env['ODOO_PWD']
    };

    if (companyId==1){
      config.username = process.env['ODOO_USER'] + '@cateringperearojas.es';
    }
    else if (companyId==4){
      config.username = process.env['ODOO_USER'] + '@colservicol.com';
    }
    else if (companyId==3){
      config.username = process.env['ODOO_USER'] + '@cateringvillablanca.es';
    }    
    else {
      config.username = process.env['ODOO_USER'].replace('_con', '') + '@cateringvillablanca.es';
    }

    return config;
  }

}

module.exports = Secure;
