const express = require('express');
const cors = require('cors');

const https = require("https"),
	fs = require("fs"),
	helmet = require("helmet");

if (process.argv.indexOf('-dev') >= 0)
	require('dotenv').config({ path: __dirname + '/.env.dev' });
else
	require('dotenv').config();

const multer = require('multer');
const parser = require('xml2json');
const mysql = require('mysql');
const _ = require('lodash');

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
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

const Odoo = require('odoo-xmlrpc');

const DbApi = require('./lib/db-api');
const Secure = require('./lib/secure');

const secure = new Secure(process.env['TOKEN_SECRET']);

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
app.use(bodyParser.json({limit: '10mb', extended: true}))
app.use(bodyParser.urlencoded({limit: '10mb', extended: true}))

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

		var odoo = new Odoo(secure.odooConfigCatering(0));
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

	var odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));
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

	var odoo = new Odoo(secure.odooConfigCatering(0));
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

	var odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));		
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

	var odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));
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

	var odoo = new Odoo(secure.odooConfigCatering(req.body.companyId));		
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

	var odoo = new Odoo(secure.odooConfigCatering(0));		
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
	var odoo = new Odoo(secure.odooConfigCatering(0));	
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
		uid: null,
		schools: [],
		contador_fallos: 0,
		ultimo_acceso: null,
		settings: [],
		roles: [],
	};

	let control_odoo = new Odoo({
		url: process.env['ODOO_URL'],
		port: process.env['ODOO_PORT'],
    db: process.env['ODOO_DB'],   
		username: req.body.username,
		password: req.body.password,
	});

	control_odoo.connect(function (err, uid) {
    if (err) return res.send({ error: true, data: err, message: 'Error usuario / contraseña no válidos' });

		profesional.settings = dbapi.getSettings();
		profesional.uid = uid;

    var inParams = [];
    inParams.push([['id', '>', 0]])
    control_odoo.execute_kw('scat.school', 'search', [inParams], function (err, value) {
      if (err) res.send({ error: true, message: 'Error recuperando datos ' + JSON.stringify(err) });

      inParams = [];
      inParams.push(value); //ids
      inParams.push(['id','code','name', 'company_id']); //fields
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

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './uploads');
    }, 
    filename: function(req, file, cb) {
        cb(null, file.originalname);
    }
});


var upload = multer({ 
	storage: storage,
	fileFilter: function(req, file, cb) {
		console.log(req);
		if(req.body.password !== 'ODOO_PWD') {
			return cb(null, false);
		}

		if(file.mimetype !== 'application/xml') {
			return cb(null, false);
		}
		cb(null, true);
	} 
});

app.post('/save_albaran', (req, res) => {

	let control_odoo = new Odoo({
		url: process.env['ODOO_URL'],
		port: process.env['ODOO_PORT'],
    db: process.env['ODOO_DB'],   
		username: req.body.username,
		password: req.body.password,
  });

	control_odoo.connect(function (err) {
		if (err) return resMgr.send(req, res, true, err, 'Error conexión con backend');

		var baseUrl = req.body.readerFile;
		var splittedArr = baseUrl.split(';base64,');
		let text = new Buffer(splittedArr[1], 'base64').toString('ascii');
		jsonfile = JSON.parse(parser.toJson(text,{reversible: true}));
	
		newJson = {jsonData:jsonfile.VFPData.etiq_xml};
	
		var infoCompanyId = jsonfile.VFPData.etiq_xml[0].empresa.$t;
		var infoFechaelaboracion = new Date(jsonfile.VFPData.etiq_xml[0].fechaelaboracion.$t);
		var infoFechaconsumo = new Date(jsonfile.VFPData.etiq_xml[0].fechaconsumo.$t);
		console.log(infoFechaconsumo);
		console.log(req.body.fileName);												
		var infoDate = new Date(jsonfile.VFPData.etiq_xml[0].fechaconsumo.$t);
	
		var queryData = {date: infoDate, companyId: infoCompanyId, data: JSON.stringify(newJson), fechaelaboracion: infoFechaelaboracion, fileName: req.body.fileName, fechaconsumo: infoFechaconsumo};
		var sqlQuery = "INSERT INTO albaranes SET ?";
		dbapi.connection.query(sqlQuery, queryData, function(err, rows) {
			
			if(err) {
				return resMgr.send(null, res, err, null, 'Error guardar albaran');
			} else {
				return res.send({message: rows});
			}
	
		});
	});
});

app.get('/get_albaran', function(req, res) {

	var queryDate = req.query.date;
	var queryCode = req.query.code;

	var sqlQueryGetAlbaran = "SELECT CONVERT (data USING utf8) AS result FROM albaranes WHERE date = " + mysql.escape(queryDate);
	// var sqlQueryGetAlbaran = "SELECT CONVERT (data USING utf8) AS result FROM albaranes";
	//console.log(sqlQueryGetAlbaran);

	dbapi.connection.query(sqlQueryGetAlbaran, function(err, rows) {
		var newData=[];
		var theNumber = queryCode;
		var filteredArray = [];
		if(err) {
			res.send({message: err});
		} else {
			rows.forEach(element => {
				newData.push(JSON.parse(element.result).jsonData);
			});

			newData.forEach( element => {
				
				// filteredArray = _.filter(element, function(item){
				// 	return item.nombrecentro['$t'] === theNumber;
				// });
				console.log(element.length);
				element.forEach( elem => {			
					if(elem.codise['$t'] === theNumber) {
						filteredArray.push(elem);
					}
				})
			});

			res.send({message: filteredArray});
		}
	});
});

app.get('/get-all-albaranes-list', (req, res) => {

	var getAllAlbaranesListSqlQuery = "SELECT * FROM albaranes";

	dbapi.connection.query(getAllAlbaranesListSqlQuery, (err, rows) => {
		if(err){
			return res.send({message:err});
		} else {
			return res.send({message:rows});
		}
	});
});

app.get('/get-albaranes-for-id', (req, res) => {

	var gid = req.query.id;
	// var f = "SELECT * FROM albaranes WHERE id =" + mysql.escape(gid);
	var getAlbaranesForIDSqlQuery = "SELECT CONVERT (data USING utf8) AS result FROM albaranes WHERE id = " + mysql.escape(gid);

	dbapi.connection.query(getAlbaranesForIDSqlQuery, function(err, rows) {
		var newData=[];
		// var theNumber = queryCode;
		// var filteredArray = [];
		if(err) {
			res.send({message: err});
		} else {
			rows.forEach(element => {
				newData.push(JSON.parse(element.result).jsonData);
			});

			// newData.forEach( element => {
			// 	console.log(element.length);
			// 	element.forEach( elem => {			
			// 		if(elem.codise['$t'] === theNumber) {
			// 			filteredArray.push(elem);
			// 		}
			// 	})
			// });

			res.send({message: newData});
		}
	});

});

app.post('/save-group', (req, res) => {

	var saveGroupSqlData = {schoolId:req.body.currentSchoolId, createdAt:new Date(req.body.createdAt), userName: req.body.userName, groupName:req.body.groupName};
	var saveGroupSqlQuery = "INSERT INTO Grupo SET ?"


	dbapi.connection.query(saveGroupSqlQuery, saveGroupSqlData, (err, rows) => {
		if(err){
			return res.send({message:err});
		} else {
			return res.send({message:rows});
		}
	});

});


app.get('/get-students', (req, res) => {

	var getAllGroupStudentsSqlQuery = "SELECT * FROM EstudianteGrupo WHERE userName = "+ mysql.escape(req.query.username) + "AND schoolId = " + mysql.escape(req.query.schoolId);

	dbapi.connection.query(getAllGroupStudentsSqlQuery, (err, rows) => {
		if(err){
			console.log(err);
			return res.send({message:err});
		} else {
			return res.send({message:rows});
		}
	});
});

app.get('/get-groups', (req, res) => {

	var getAllGroupStudentsSqlQuery = "SELECT * FROM Grupo WHERE userName = "+ mysql.escape(req.query.username) + "AND schoolId = " + mysql.escape(req.query.schoolId);

	dbapi.connection.query(getAllGroupStudentsSqlQuery, (err, rows) => {
		if(err){
			console.log(err);
			return res.send({message:err});
		} else {
			return res.send({message:rows});
		}
	});
});

app.get('/get-studentIds-for-groupId', (req, res) => {

	var gid = req.query.gid;
	// var getDistinctGroupIdSqlQuery = "SELECT distinct groupId FROM EstudianteGrupo";
	var getstudentIdSqlQuery = "SELECT studentId FROM EstudianteGrupo WHERE groupId =" + mysql.escape(gid);

	dbapi.connection.query(getstudentIdSqlQuery, (err, rows) => {
		if(err){
			return res.send({message:err});
		} else {
			return res.send({message:rows});
		}
	});
});

app.post('/update-group', (req, res) => {

	var groupId = req.body.groupId;
	var createdAt = new Date(req.body.createdAt);	
	var schoolId = req.body.schoolId;
	var userName = req.body.userName;
	var students = req.body.students;

	let sqlStudentInGroupDelete = "DELETE FROM EstudianteGrupo WHERE groupId = ?";
	dbapi.connection.query(sqlStudentInGroupDelete, [groupId], (err, rows) => {
		if(err) {
			console.log(err);
		} else {

			// Inserte new students
			var addArrMain = [];			
			students.forEach( elem => {
				let addArr = [];
				addArr.push(userName);
				addArr.push(groupId);
				addArr.push(elem);
				addArr.push(createdAt);
				addArr.push(schoolId);
				addArrMain.push(addArr);
			});
	
			var sqlAdd = "INSERT INTO EstudianteGrupo (userName, groupId, studentId, createdAt, schoolId) VALUES ?";
			var values = addArrMain;
			dbapi.connection.query(sqlAdd, [values], (err, rows) => {
				if(err) {
					console.log(err);
				} else {
					studentRemovedRows = rows;
				}
			});

			return res.send({message: rows});
		}
	});


});

app.post('/delete-group-and-students-in-it', (req, res) => {
	let groupId = req.body.groupId;

	let sqlGroupDelete = "DELETE FROM Grupo WHERE id = ?"
	dbapi.connection.query(sqlGroupDelete, [groupId], (err, rows) => {
		if(err){
			console.log(err);
		} else {
			let sqlStudentInGroupDelete = "DELETE FROM EstudianteGrupo WHERE groupId = ?";
			dbapi.connection.query(sqlStudentInGroupDelete, [groupId], (err, rows) => {
				if(err) {
					console.log(err);
				} else {
					return res.send({message: rows});
				}
			});
		}
	})
});

app.get('/check-user-role', (req, res) => {
	console.log(req.query.username);

	sqlGetRoleId = "SELECT roleId FROM userRoles WHERE username =" + mysql.escape(req.query.username);
	dbapi.connection.query(sqlGetRoleId, (err, rows) => {
		if(err){
			res.send({"message":err});
		} else {
			// res.send({"message":rows});
			console.log(rows[0].roleId);

			sqlGetAccessForRoleId = "SELECT access FROM roles WHERE id =" + mysql.escape(rows[0].roleId);
			dbapi.connection.query(sqlGetAccessForRoleId, (err, row) => {
				if(err){
					res.send({"message":err});
				} else {
					res.send({"message":row});
				}
			});

		}
	});
});

///////////////////////////////////////////////////////////////
// GESTION DE DOCUMENTACION
///////////////////////////////////////////////////////////////

// Display all documents
app.get('/docs', (request, response) => {

	console.log(request);
	var sqlQuery = "SELECT * FROM docs";

	dbapi.connection.query( sqlQuery, (error, result) => {
        if (error) throw error;
		 response.send(result);
		 console.log("resultado docs" + result);
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