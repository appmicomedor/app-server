CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL,
  `username` varchar(255) DEFAULT NULL,
  `password` varchar(255) DEFAULT NULL,
  `ultimo_acceso` datetime DEFAULT NULL,
  `contador_fallos` int(1) DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `roles` (
  `id` int(11) NOT NULL,
  `role` varchar(45) DEFAULT NULL,
  `access` varchar(345) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

INSERT INTO `roles` VALUES 
(1,'Administrador','Control_de_Presencia,Subir_Albaranes,Ver_Albaranes'),
(2,'Calidad','Subir_Albaranes'),
(3,'Recibos',NULL),
(4,'Repartidor','Ver_Albaranes'),
(5,'Responsable','Control_de_Presencia,Ver_Albaranes');

CREATE TABLE `userRoles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(145) NOT NULL,
  `roleId` int(11) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8;
SELECT * FROM odoo_api_db.userRoles;

INSERT INTO `odoo_api_db`.`userRoles` (`username`, `roleId`) VALUES ('14000926@cateringvillablanca.es', '5');
INSERT INTO `odoo_api_db`.`userRoles` (`username`, `roleId`) VALUES ('apptitular_con@cateringperearojas.es', '1');
INSERT INTO `odoo_api_db`.`userRoles` (`username`, `roleId`) VALUES ('apptitular_con@cateringvillablanca.es', '2');
INSERT INTO `odoo_api_db`.`userRoles` (`username`, `roleId`) VALUES ('apptitular_con@colservicol.com', '3');
INSERT INTO `odoo_api_db`.`userRoles` (`username`, `roleId`) VALUES ('repartidor01@cateringvillablanca.es', '4');

CREATE TABLE `albaranes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `date` date DEFAULT NULL,
  `companyId` varchar(45) DEFAULT NULL,
  `data` longblob,
  `fechaelaboracion` date DEFAULT NULL,
  `fileName` varchar(45) DEFAULT NULL,
  `fechaconsumo` date DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=55 DEFAULT CHARSET=utf8;
ALTER TABLE `albaranes` ADD UNIQUE( `date`, `companyId`);

ALTER TABLE `usuarios`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_email` (`username`);

ALTER TABLE `usuarios`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

CREATE TABLE `historial` (
  `id` int(11) NOT NULL,
  `userId` int(11) DEFAULT NULL,
  `parentId` int(11) DEFAULT NULL,    
  `childId` int(11) DEFAULT NULL,  
  `date` datetime NOT NULL, 
  `createdAt` datetime NOT NULL, 
  `value` int(11) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `historial`
  ADD PRIMARY KEY (`id`);
ALTER TABLE `historial`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

ALTER TABLE `historial` ADD COLUMN `titular` varchar(512) DEFAULT NULL;
ALTER TABLE `historial` ADD COLUMN `tipo` int(1) DEFAULT 0;

CREATE TABLE `Grupo` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `schoolId` varchar(255) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `userName` varchar(45) DEFAULT NULL,
  `groupId` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8;
ALTER TABLE `Grupo`
  ADD PRIMARY KEY (`id`);

CREATE TABLE `EstudianteGrupo` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `userName` varchar(255) DEFAULT NULL,
  `groupId` varchar(255) DEFAULT NULL,
  `studentId` int(11) DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
ALTER TABLE `EstudianteGrupo`
  ADD PRIMARY KEY (`id`);
ALTER TABLE `EstudianteGrupo` 
ADD COLUMN `school` VARCHAR(345) NOT NULL AFTER `createdAt`;


CREATE TABLE `Settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,  
  `name` varchar(255) DEFAULT NULL,
  `value` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
ALTER TABLE `Settings`
  ADD PRIMARY KEY (`id`);

INSERT INTO Settings (id, name, value)
VALUES (1, 'control_days_prev', '80');

create table  docs_cat (
  id int auto_increment not null primary key,
  title varchar(32)
);

create table docs (
  id int auto_increment not null primary key,
  cat_id int not null,
  descripcion varchar(250) not null,
  url varchar(3000) not null,
  foreign key (cat_id) references docs_cat(id)
);

ALTER TABLE `docs` 
CHANGE `descripcion` `descripcion` VARCHAR(250) CHARACTER SET utf8 COLLATE utf8_unicode_ci NOT NULL, 
CHANGE `url` `url` VARCHAR(3000) CHARACTER SET utf8 COLLATE utf8_unicode_ci NOT NULL;

