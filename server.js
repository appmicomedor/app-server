const express = require('express');
const cors = require('cors');

const https = require("https"),
	fs = require("fs"),
	helmet = require("helmet");

if (process.argv.indexOf('-dev') >= 0)
	require('dotenv').config({ path: __dirname + '/.env.dev' });
else
	require('dotenv').config();

console.log('Environment ' + process.env['NODE_ENV']);

const app = express();
const allowedOrigins = [
	'capacitor://localhost',
	'ionic://localhost',
	'http://localhost',
	'http://localhost:8100',
	'https://95.179.163.170',
	'https://apptitular.micomedor.net',
	'https://appcontrolpresencia.micomedor.net',
];
const bodyParser = require('body-parser');

const Odoo = require('odoo-xmlrpc');

const DbApi = require('./lib/db-api');
const Secure = require('./lib/secure');

const secure = new Secure(process.env['TOKEN_SECRET']);
var odoo = new Odoo(secure.odooConfigCatering(0));

const ResponseMgr = require('./lib/response-mgr');
const resMgr = new ResponseMgr();

const corsOptions = {
	origin: (origin, callback) => {
		if (allowedOrigins.includes(origin) || !origin) {
			callback(null, true);
		} else {
			callback(new Error('Origin not allowed by CORS'));
		}
	}
}

app.options('*', cors(corsOptions));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
	extended: true
}));
app.use(helmet());
app.use(function (req, res, next) {

	// Website you wish to allow to connect
	res.setHeader('Access-Control-Allow-Origin', '*');

	// Request methods you wish to allow
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');

	// Request headers you wish to allow
	res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');

	// Set to true if you need the website to include cookies in the requests sent
	// to the API (e.g. in case you use sessions)
	res.setHeader('Access-Control-Allow-Credentials', true);

	// Pass to next layer of middleware
	next();
});

// default route
app.get('/', function (req, res) {
	return res.send({ error: true, message: 'hello' })
});

const dbapi = new DbApi();
dbapi.connect(process.env['MYSQL_HOST'], process.env['MYSQL_USER'], process.env['MYSQL_PWD'], process.env['MYSQL_DB']);

// Login
app.post('/login', function (req, res) {

	if (!req.body.password || req.body.password.length != 6)
		return resMgr.send(req, res, true, null, 'Contraseña no válida' );

	var titular = {
		id: null,
		db_id: null,
		username: req.body.username,
		password: req.body.password,
		name: null,
		bank: null,
		childs: [],
		ref: null,
		contador_fallos: 0,
		ultimo_acceso: null,
		token: null
	};

	var sql = "SELECT * from usuarios WHERE username = '" + req.body.username + "'";
	dbapi.connection.query(sql, function (err, rows) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión base de datos');

		if (rows.length > 0) {
			titular.db_id = rows[0]['id'];
			titular.contador_fallos = rows[0]['contador_fallos'];

			if (titular.contador_fallos >= 20) {
				titular.ultimo_acceso = dbapi.toDateFormat(rows[0]['ultimo_acceso']);

				let tz = 1000 * 60 * Number(new Date().getTimezoneOffset());
				let day1 = 1000 * 3600 * 24;
				let now = new Date();
				let dif = now.getTime() + tz - titular.ultimo_acceso.getTime();
				if (dif < day1) {
					dbapi.errorAccess(titular);
					return resMgr.send(req, res, true, null, 'El usuario ha sido bloqueado, consulte con soporte.' );
				}
			}
		}

		odoo.connect(function (err) {
			if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

			var inParams = [];
			inParams.push([['x_ise_nie', '=', req.body.username]]);
			odoo.execute_kw('res.partner', 'search', [inParams], function (err, value) {
				if (err) return resMgr.send(req, res, true, err, 'Error de acceso código:1');

				inParams = [];
				inParams.push(value); //ids
				inParams.push(['name', 'bank_ids', 'child_ids', 'ref']); //fields

				odoo.execute_kw('res.partner', 'read', [inParams], function (err, value) {
					if (err || !value || value.length == 0) return resMgr.send(req, res, true, err, 'Error de acceso código:2');
					titular.id = value[0].id;
					titular.name = value[0].name;
					titular.ref = value[0].ref;

					// Find banks
					inParams = [];
					inParams.push([['partner_id', '=', titular.id]]);
					odoo.execute_kw('res.partner.bank', 'search', [inParams], function (err, value) {
						if (err) {
							dbapi.errorAccess(titular);
							return resMgr.send(req, res, true, err, 'Error de acceso código:3' );
						}
						var inParams = [];
						inParams.push(value); //ids
						inParams.push(['acc_number', 'mandate_ids', 'partner_id', 'acc_type', 'bank_bic', 'bank_name']); //fields

						odoo.execute_kw('res.partner.bank', 'read', [inParams], function (err, value) {
							if (err || !value || value.length == 0) {
								dbapi.errorAccess(titular);
								return resMgr.send(req, res, true, titular, 'Error de acceso código:4' );
							}

							let found = false;
							for (let i = 0; i < value.length; i++) {
								if (value[i].acc_number && value[i].acc_number.length > 6) {
									let digits = value[i].acc_number.replace(/\s/g, '').slice(-6);
									if (digits == req.body.password) {
										found = true;
										titular.bank = value[i];
										break;
									}
								}
							}
							if (!found) {
								dbapi.errorAccess(titular);
								return resMgr.send(req, res, true, err, 'Contraseña no válida');
							}

							// Find childs
							inParams = [];
							inParams.push([['parent_id', '=', titular.id]]);
							odoo.execute_kw('res.partner', 'search', [inParams], function (err, value) {
								if (err) return resMgr.send(req, res, true, err, 'Error de acceso código:5' );
								var inParams = [];
								inParams.push(value); //ids
								inParams.push(['name', 'active_school_id', 'company_id', 'x_ise_estado']); //fields

								odoo.execute_kw('res.partner', 'read', [inParams], function (err, value) {
									if (err) return resMgr.send(req, res, true, err, 'Error de acceso código:6' );

									if (value && value.length > 0)
										titular.childs = value;

									dbapi.okAccess(titular);

									titular.token = secure.createToken(titular);
									return resMgr.send(req, res, false, titular, 'success');
								});
							});
						});
					});
				});
			});
		});
	});
});

app.post('/get_month', function (req, res) {

	if (req.body.childId==null)
		req.body.childId = req.body.student_id;

	if (process.env['TOKEN_ENABLED'] && !secure.ensureAuthenticated(req, res, req.body.childId))
		return resMgr.send(req, res, true, null, 'Error de autorización, token no válido');

	odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));
	odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');
		
		var inParams = [];
		inParams.push([['student_id', '=', Number(req.body.childId)], ['year', '=', req.body.year], ['month', '=', req.body.month]]);
		odoo.execute_kw('scat.student', 'search', [inParams], function (err, value) {
			if (err || !value || value.length == 0) return resMgr.send(req, res, true, err, 'No hay datos');
			var inParams = [];
			let id = value[0];
			inParams.push(value[0]); //ids
			var fields = [];
			for (var i = 1; i <= 31; i++) {
				fields.push('dia' + i);
			}
			inParams.push(fields); //fields

			odoo.execute_kw('scat.student', 'read', [inParams], function (err, value) {
				if (err || !value || value.length == 0) return resMgr.send(req, res, true, err, 'Error de acceso código:7');
				return res.send({ error: false, data: value, time: new Date(), id: id, message: 'success' });
			});
		});
	});
});

app.post('/get_preaviso', function (req, res) {

	odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
		inParams.push([['school_ids', '=', Number(req.body.school_id)], ['end_date', '=', false]]);
		odoo.execute_kw('scat.expediente', 'search', [inParams], function (err, value) {
			if (err || !value || value.length == 0) { return res.send({ error: true, message: 'No hay datos ' }); }

			var inParams = [];
			inParams.push(value); //ids
			inParams.push(['preaviso', 'school_id', 'n_expediente', 'end_date']); //fields

			odoo.execute_kw('scat.expediente', 'read', [inParams], function (err, value) {
				if (err || !value || value.length == 0) return res.send({ error: true, message: 'Error de acceso código:8' });
				return res.send({ error: false, data: value, message: 'success' });
			});
		});
	});
});

app.post('/get_asistencia', function (req, res) {

	if (req.body.childId==null)
		req.body.childId = req.body.child_id;

	if (process.env['TOKEN_ENABLED'] && !secure.ensureAuthenticated(req, res, req.body.childId))
		return resMgr.send(req, res, true, null, 'Error de autorización, token no válido');

	odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));		
	odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
		inParams.push([['id', '=', Number(req.body.childId)]]);
		odoo.execute_kw('res.partner', 'search', [inParams], function (err, value) {
			if (err || !value || value.length == 0) { return res.send({ error: true, message: 'No hay datos ' }); }

			var inParams = [];
			inParams.push(value); //ids
			inParams.push(['y_ise_factura_aut', 'y_ise_s', 'y_ise_l', 'y_ise_m', 'y_ise_x', 'y_ise_j', 'y_ise_v']); //fields

			odoo.execute_kw('res.partner', 'read', [inParams], function (err, value) {
				if (err || !value || value.length == 0) return res.send({ error: true, message: 'Error de acceso código:9' });
				return res.send({ error: false, data: value, message: 'success' });
			});
		});
	});
});

app.post('/set_asistencia', function (req, res) {


	if (process.env['TOKEN_ENABLED'] && !secure.ensureAuthenticated(req, res, req.body.childId))
		return resMgr.send(req, res, true, null, 'Error de autorización, token no válido');

	odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));
	odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
		inParams.push([Number(req.body.childId)]); //id to update
		let jsonData = {
			'y_ise_factura_aut': req.body.y_ise_factura_aut,
			'y_ise_s': req.body.y_ise_s,
			'y_ise_l': req.body.y_ise_l,
			'y_ise_m': req.body.y_ise_m,
			'y_ise_x': req.body.y_ise_x,
			'y_ise_j': req.body.y_ise_j,
			'y_ise_v': req.body.y_ise_v,
		};
		inParams.push(jsonData);

		odoo.execute_kw('res.partner', 'write', [inParams], function (err, value) {
			if (err) return resMgr.send(req, res, true, err, 'Error escritura en backend, contacte con soporte');

			dbapi.setHistorial(req.body.userId, req.body.parentId, req.body.childId, null, JSON.stringify(jsonData), req.body.titular, 1);

			return resMgr.send(req, res, false, value, 'success' );
		});
	});
});


app.post('/set_day', function (req, res) {

	if (process.env['TOKEN_ENABLED'] && !secure.ensureAuthenticated(req, res, req.body.childId))
		return resMgr.send(req, res, true, null, 'Error de autorización, token no válido');

	odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));		
	odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
		inParams.push([Number(req.body.id)]); //id to update
		let aux = {};
		aux[req.body.dia] = req.body.value;
		inParams.push(aux);

		odoo.execute_kw('scat.student', 'write', [inParams], function (err, value) {
			if (err) return resMgr.send(req, res, true, err, 'Error escritura en backend, contacte con soporte');
			let jsonData = {
				value: req.body.value
			};
			dbapi.setHistorial(req.body.userId, req.body.parentId, req.body.childId, req.body.date, JSON.stringify(jsonData), req.body.titular, 0);
			return resMgr.send(req, res, false, value, 'success' );
		});

	});
});

app.post('/set_bank', function (req, res) {

	if (process.env['TOKEN_ENABLED'] && !secure.ensureAuthenticated(req, res, req.body.parentId))
		return resMgr.send(req, res, true, null, 'Error de autorización, token no válido');

	odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
		//inParams.push([Number(req.body.id)]); //id to update
		inParams.push({
			'acc_number': req.body.acc_number,
			'partner_id': Number(req.body.parentId)
		});

		console.log('inParams ' + JSON.stringify(inParams));
		odoo.execute_kw('res.partner.bank', 'create', [inParams], function (err, value) {
			if (err) { return res.send({ error: true, data: err, message: 'Error escritura en backend, contacte con soporte' }); }
			return res.send({ error: false, data: value, message: 'success' });
		});
	});
});

// Add a new user  
app.post('/get_fields', function (req, res) {
	odoo.connect(function (err) {
		if (err) { return console.log(err); }
		console.log('Connected to Odoo server.');
		var inParams = [];
		inParams.push([]);
		inParams.push([]);
		inParams.push([]);
		inParams.push(['string', 'help', 'type']);  //attributes
		odoo.execute_kw('res.partner', 'fields_get', [inParams], function (err, value) {
			if (err) { return console.log(err); }
			return res.send({ error: false, data: value, message: 'success' });
		});
	});
});

app.post('/get_historico', function (req, res) {
	dbapi.connection.query('SELECT * FROM historial WHERE childId=' + req.body.childId + ' ORDER BY createdAt DESC',
		function (error, rows, fields) {
			var objs = [];
			for (var i = 0; i < rows.length; i++) {
				objs.push(rows[i]);
			}
			return res.send({ error: false, data: objs, message: 'success' });
		});
});

///////////////////////////////////////////////////////////////
// APP CONTROL PRESENCIA API
///////////////////////////////////////////////////////////////
// Login
app.post('/control-login', function (req, res) {

	if (!req.body.password)
		return res.send({ error: true, data: null, message: 'Contraseña no válida' });

	var profesional = {
		db_id: null,
		username: req.body.username,
		password: req.body.password,
		schools: [],
		contador_fallos: 0,
		ultimo_acceso: null
	};

	let control_odoo = new Odoo({
		url: process.env['ODOO_URL'],
		port: process.env['ODOO_PORT'],
    db: process.env['ODOO_DB'],   
		username: req.body.username,
		password: req.body.password,
	});

	control_odoo.connect(function (err) {
    if (err) return res.send({ error: true, data: err, message: 'Error usuario / contraseña no válidos' });

    var inParams = [];
    inParams.push([['id', '>', 0]])
    control_odoo.execute_kw('scat.school', 'search', [inParams], function (err, value) {
      if (err) res.send({ error: true, message: 'Error recuperando datos ' + JSON.stringify(err) });

      inParams = [];
      inParams.push(value); //ids
      inParams.push(['id','code','name']); //fields

      control_odoo.execute_kw('scat.school', 'read', [inParams], function (err, value) {
        if (err || !value || value.length == 0) { return res.send({ error: true, message: 'No hay escuelas para este usuario '}); }

        if (value && value.length > 0)
          profesional.schools = value;

        return res.send({ error: false, data: profesional, message: 'success' });
      });
    });
	});
});


app.post('/control-get-school', function (req, res) {

	let control_odoo = new Odoo({
		url: process.env['ODOO_URL'],
		port: process.env['ODOO_PORT'],
    db: process.env['ODOO_DB'],   
		username: req.body.username,
		password: req.body.password,
  });
    
	control_odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
    inParams.push([['school_id', '=', Number(req.body.school_id)], ['year', '=', req.body.year], ['month', '=', req.body.month]]);
    inParams.push(['dia' + req.body.day, 'id', 'student_name']);

		control_odoo.execute_kw('scat.student', 'search_read', [inParams], function (err, value) {
      if (err || !value || value.length == 0) { return res.send({ error: true, message: 'No hay datos para la selección ' }); }
      return res.send({ error: false, data: value, message: 'success' });
		});
	});
});

app.post('/control-set-day', function (req, res) {

	let control_odoo = new Odoo({
		url: process.env['ODOO_URL'],
		port: process.env['ODOO_PORT'],
    db: process.env['ODOO_DB'],   
		username: req.body.username,
		password: req.body.password,
  });

	control_odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var inParams = [];
		inParams.push([Number(req.body.id)]); //id to update
		let aux = {};
		aux[req.body.dia] = req.body.value;
		inParams.push(aux);

		control_odoo.execute_kw('scat.student', 'write', [inParams], function (err, value) {
			if (err) { return res.send({ error: true, data: err, message: 'Error escritura en backend, contacte con soporte' }); }
			return res.send({ error: false, data: value, message: 'success' });
		});
	});
});

if (process.env['NODE_ENV'] != 'development') {
	const options = {
		key: fs.readFileSync("/etc/letsencrypt/live/apptitular.micomedor.net/privkey.pem"),
		cert: fs.readFileSync("/etc/letsencrypt/live/apptitular.micomedor.net/cert.pem")
	};
	https.createServer(options, app).listen(3000);
}
else {
	app.listen(3000);
}
console.log('Node server listen on port ' + 3000);

module.exports = app;