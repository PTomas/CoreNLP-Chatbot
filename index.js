require('dotenv').config();
const express = require('express');
const session = require('express-session')
const path = require('path');
const fs = require("fs");
const bodyParser = require('body-parser');
const { fileURLToPath } = require('url');
const mongoose = require('mongoose');
var mongodb = require('mongodb');
var MongoClient = require('mongodb').MongoClient;
const router = require('./routes/router.js');

var db;
var waiting = [];

const port = process.env.PORT || 3000;
const dbURL = process.env.MONGO_URL;

const app = express();


app.use(session({
  secret: 'Your_Secret_Key', 
  resave: true, 
  saveUninitialized: true
}))

app.engine('html', require('ejs').renderFile);
app.set('view engine', 'ejs');

app.use(bodyParser.json());
app.use(
  bodyParser.urlencoded({
    extended: true,
  }),
);

app.use('/', require('./routes/router.js'));
app.use(router);


app.use('/css', express.static(path.join(__dirname + "/public/css")));
app.use('/js', express.static(path.join(__dirname + "/public/js")));
app.set('views', path.join(__dirname, 'views'));

const client = new MongoClient(dbURL)

app.listen(port, function () {
  console.log('Bot listening on port 3000!');
});

// mongoose.connect(dbURL)//add mongoose connection to db
//   .then((result) => app.listen(port, async function () {
//     console.log('Server started at http://localhost:' + port);
//   }))
//   .catch((err) => console.log(err))

// mongoose.connection.collection("datamodels").deleteMany({})