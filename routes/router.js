const express = require('express')
const session = require('express-session')
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const bodyParser = require('body-parser');
const { createResponce, adjacentWord, trainModel } = require("../controller.js");
const control = require("../controller.js");
const dataModel = require('../models/data.js')

const { get } = require('https');
const { send } = require('process');
const { Query } = require('mongoose');


const router = express.Router();

router.use(bodyParser.json())
router.use(bodyParser.urlencoded({ extended: true }))

let getResponce

const PIPER = path.join(__dirname, '../piper', process.platform === 'win32' ? 'piper.exe' : 'piper');
const MODEL = path.join(__dirname, '../en_US-amy-medium.onnx');

function synthesize(text, outFile) {
  return new Promise((resolve, reject) => {
    const piper = spawn(PIPER, ['--model', MODEL, '--output_file', outFile]);
    piper.on('error', reject);
    piper.on('close', code => code === 0 ? resolve() : reject(new Error(`piper exited ${code}`)));
    piper.stdin.end(text); // piper reads the text from stdin
  });
}

router.post('/speak', async (req, res) => {
  const file = path.join(__dirname, `reply-${Date.now()}.wav`);
  try {
    await synthesize(req.body.text, file);
    res.sendFile(file, () => fs.unlink(file, () => {})); // delete after sending
  } catch (err) {
    console.error(err);
    res.status(500).send('TTS failed');
  }
});

router.get('/', function (req, res) {
  res.sendFile(path.join(__dirname, '../views', 'chatIndex.html'));
});

router.post("/", async function (req, res){
  getResponce = req.body.query;
  console.log(getResponce)
  res.sendStatus(200)
})


router.post("/speak", async (req, res) => {
  const file = path.join(__dirname, `reply-${Date.now()}.wav`);
  try {
    await synthesize(req.body.text, file);
    res.sendFile(file, () => fs.unlink(file, () => {})); // delete after sending
  } catch (err) {
    console.error(err);
    res.status(500).send("TTS failed");
  }
});

// router.get('/greet', async function (req, res) {
//   // const queryData = await createResponce(getResponce)
//   // console.log(await createResponce(getResponce))

//   // const [reply] = await adjacentWord(queryData, getResponce)
//   // console.log("working")

//   const authorize = await whoWantsToKnow()//initiate conversation
//   res.json(authorize)

// });


router.get('/answers', async function (req, res) {
  var answerArray = []
  // let myAnswer = await dataModel.findOne({Query: getResponce}).sort({_id : -1}).limit(1).skip(1).select('Responce')
  
  const queryData = await createResponce(getResponce)//analyze question

  const [reply, sentArr] = await adjacentWord(queryData, getResponce)//respond to complex question

  const [authorize, interval, botScore] = await trainModel(reply, sentArr)//ask more questions answer simple questions 
  answerArray.push(authorize)
  
  
  // const double = authorize;
  // if(double.includes("Nice to meet you")){
  //   // getResponce = double
  //   // const queryData = await createResponce(double)//analyze answer

  //   // const reply = await adjacentWord(queryData, getResponce)//process meaning and ask complex question

  //   var [authorize2, interval2] = await whoWantsToKnow(double, getResponce)//ask more questions answer simple questions 
  
  //   answerArray.push(authorize2)  
  // }

  res.json({data: answerArray, score: botScore, timer: interval})

 
});



module.exports = router ;
