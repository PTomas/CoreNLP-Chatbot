const { Properties, Pipeline, ConnectorServer } = require('corenlp');
const sentiment = require('corenlp-sentiment')
const CoreNLP = require('corenlp')
const { response } = require('express');
const axios = require("axios");
const fs = require("fs");
const readline = require('readline');
const cheerio = require("cheerio");
const Bottleneck = require("bottleneck"); 
const closest_match = require("closest-match");

//const { contains } = require('cheerio/lib/static.js');

var botScore = 0;
var user;
const NiceSyn = ["enjoyable", "pleasant", "pleasurable", "agreeable", "delightful", "satisfying", "gratifying", "acceptable", "to one's liking", "entertaining", "amusing", "diverting", "marvelous", "good", "bonny", "couthy", "irie", "lovely", "great", "neat", "lekker", "mooi"]
const posTagSet = ["CC", "CD", "DT", "EX", "FW", "IN", "JJ", "JJR", "JJS", "LS", "MD", "NN", "NNS", "NNP", "NNPS", "PDT", "POS", "PRP", "PP", "PRP$", "RB", "RBR", "RBS", "RP", "SYM", "TO", "UH", "VB", "VBD", "VBG", "VBN", "VBP", "VBZ", "WDT", "WP", "WP$", "WRB"]
const LRD = ["Z", "D", "G", "N"]
const syntacticTagSet = ["ADJP", "ADVP", "NP", "PP", "S", "SBAR", "SBARQ", "SINV", "SQ", "VP", "WHADVP", "WHNP", "WHPP", "X"] 
const prompts = ["Playing any fun games", "How's work been", "Go any where cool", "Meet any one", "Make anything new", "Whats your day been like"]
var original
var memoryHelper
var usedWordsIndex = [];
var wordArray
var upperStr
var replyArray
var upperReply
var storedRes = false;
var convoController = false;
var retry = false;
let counter = 0;
let timer = 1;

var yourName;
var ansQuest;
let dayLvl = 0;
let buildLvl = 0;
let loveLvl = 0;
let placeLvl = 0;
let workLvl = 0;
let gameLvl = 0;
let subCount = 0;
//search dictionary for requested term and store it in object
async function apiRequest(term, callback) {
  try {
    const jsonString = await fs.readFileSync("./assets/dictionary.json", "utf8");
    const jsonData = JSON.parse(jsonString);

    // Normalize the term
    const normalizedTerm = term.trim().toLowerCase();

    // 1. Try an exact match
    if (jsonData[normalizedTerm]) {
      const exactMatch = `${normalizedTerm}: ${jsonData[normalizedTerm]}`;
      callback(JSON.stringify({ first: exactMatch, second: "Exact match only" }));
      return;
    }

    // 2. If no exact match, try partial/fuzzy match
    const matches = Object.entries(jsonData).filter(([key]) =>
      key.toLowerCase().includes(normalizedTerm)
    );

    const first = matches[0] ? `${matches[0][0]}: ${matches[0][1]}` : "No match";
    const second = matches[1] ? `${matches[1][0]}: ${matches[1][1]}` : "No second match";

    callback(JSON.stringify({ first, second }));
  } catch (err) {
    console.error("Error reading or parsing file:", err);
    callback(null);
  }
}
async function apiRequest2(word, callback){
  const normalizedTerm = word.trim().toLowerCase();
  const stream = fs.createReadStream('./assets/en_thesaurus.jsonl', 'utf8');

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  const allSynonyms = [];

  rl.on('line', (line) => {
    if (!line.trim()) return;

    try {
      const obj = JSON.parse(line);
      if (obj.word.toLowerCase() === normalizedTerm) {
        if (Array.isArray(obj.synonyms) && obj.synonyms.length > 0) {
          allSynonyms.push(...obj.synonyms);
        }
      }
    } catch (err) {
      console.error('Parse error on line:', line);
      rl.close();
      callback(null);
    }
  });

  rl.on('close', () => {
    allSynonyms.push(word)
    callback(allSynonyms);
  });

  rl.on('error', (err) => {
    console.error('Error reading file:', err);
    callback(null);
  });
}

// async function apiRequest2(word, callback){
//   var syns = [];
//   await axios.get('https://api.api-ninjas.com/v1/thesaurus', {
//     params: {
//         'X-Api-Key': "MsYE+YM0mzUlXGvDRNhvvg==swl2OxQQcLx6nlmu",
//         word: word
//     }
//     }).then(async response => {
//         syns = response.data.synonyms;
//         await syns.push(word);
//     }).catch(async error => {
//         await console.error(error);
//     });
//     callback(syns);
// }

/************************************************************** */
async function createResponce(getResponce, ansQuest) {//corenlp
  var result = [];
  var apostrophe = ["dont", "didnt", "wont"];
  if(getResponce){
    await axios.get('http://localhost:7000/sentiment', {
      params: {
          text: getResponce
      }
      }).then(async response => {

          await result.push(response.data.dependencies);
          await console.log(response.data.dependencies)
      }).catch(async error => {
          await console.error(error);
      });
      return result;
  }else if(ansQuest){
    await axios.get('http://localhost:7000/sentiment', {
      params: {
          text: ansQuest
      }
      }).then(async response => {
          await result.push(response.data.dependencies);
      }).catch(async error => {
          await console.error(error);
      });
      return result;
  }
}
/**************************************************************/
//assumption genorator
var assumptionCreate = false;
var newTopicCreate = false;
/**************************************************************/
//outlines to train
let savedSet = 1;
let savedCType;
var reoccourring = 1;
var testOptions = [];

function trainModel(reply, sentArr) {
  const jsonString = fs.readFileSync("./assets/models.json", "utf8");
  const jsonData = JSON.parse(jsonString);
  // find most frequent sentClass in sentArr
  const freq = {};
  sentArr.forEach(item => {
    if(item) freq[item] = (freq[item] || 0) + 1;
  });
  const mostCommon = Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b);

  // get the object with that sentClass
  let sentType = sentArr.find(item => item === mostCommon);
  
    // const left = document.querySelector('.border-box');
    // const right = document.querySelector('.border-box1');
    // const textbox = document.querySelector('.text');
    var myVariable = reply;
    var contentType = "";
    var contentValue = 0; 
    let inFollowup = false; // are we in a follow-up question?
    let currentSet = 1; // which group of questions we’re in
    var edit = null; 
    var edit2 = null;

    assess(myVariable, sentType);

    function assess(myVariable, sentType) {
      var contentValue;
      
      if(assumptionCreate === true){
        if (sentType.includes("positive")) {
          sentType = sentType.replace("positive", "negetive");
        }
      }
      const typeMatched = jsonData[0][sentType];      let bestMatch = null;
      let bestScore = -1;//outside forEach to save the best match score 
      let highScore = -1;
      let lowScore = 11;

      let score;
      typeMatched.forEach(option => {
        const model = option.sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ");
        const similar = myVariable.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ");
        const matches = model.filter(word => similar.includes(word)).length;
       

        if(model.every(word => similar.includes(word))) {
          console.log("100% match")
          score = Infinity; 
        }else{
          console.log("% match")
          score = matches;
        }

        if(score > bestScore){
          //set option to best score if it is the greatest
          bestScore = score;
          bestMatch = option;
          contentOption = option.contentType;
          contentValue = option.score;
          if(sentType.includes("negetive") || sentType.includes("Negetory")) {
            botScore -= contentValue;
          }else {
            botScore += contentValue;
          }
        }
      });

      

      testOptions.push(contentOption);
      if(bestMatch) {//might be a mixed message
        contentType = bestMatch.contentType;
        contentValue = Number(bestMatch.currentSet);
      }
    
      if(newTopicCreate){
        reoccourring++;
      }

      if(reoccourring >= 4){
        reoccourring = 1;
      }

      if(contentType !== savedCType && reoccourring !== 1){
        reoccourring = 1;
        savedCType = contentType;
      }
      
      //keep seperate for both conditions to run
      if(contentType === "discourse-prep-prop" || contentType === "discourse-prep-nouns") {
        currentSet = contentValue;
        savedCType = contentType;
        showFollowup(contentType);
      }else if(contentType === "discourse-nouns" || contentType === "discourse-adjectives") {
        currentSet = savedSet;
        savedCType = contentType;
        showFollowup(contentType);
      }else if(contentType === "actions-think") {
        currentSet = contentValue;
        savedCType = contentType;
        showFollowup(contentType);
      }else if(reoccourring === 1 && contentValue === 1){
        currentSet = 1;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 2 && contentValue === 1){
        currentSet = 2;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 3 && contentValue === 1){
        currentSet = 3;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 1 && contentValue === 2){
        currentSet = 2;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 2 && contentValue === 2){
        currentSet = 2;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 3 && contentValue === 2){
        currentSet = 3;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 1 && contentValue === 3){
        currentSet = 3;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 2 && contentValue === 3){
        currentSet = 3;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }else if(reoccourring === 3 && contentValue === 3){
        currentSet = 3;
        savedSet = currentSet;
        savedCType = contentType;
        reoccourring++;
        showFollowup(contentType);
      }
    }
    console.log(reoccourring)
    
    function showFollowup(contentType) {
      console.log("content type: " + contentType)
      console.log("current set: " + currentSet)
      inFollowup = true;
      let followups = [];
    
      if (currentSet === 1) {
        if (contentType === "actions-positive") followups = [
          "Im glad.",
          "Thats great to hear.",
          "That sounds like fun."
        ]; 
        else if (contentType === "actions-negetive") followups = [
          "Im sorry.",
          "Thats too bad.",
          "Thats no fun."
        ];
        else if (contentType === "actions-personal-positive") followups = [
          "Do you have animations for sale currently?",
          "Do you have code for sale currently?",
          "Have you made money from animating?"
        ];
        else if (contentType === "actions-personal-negetive") followups = [
          "How are things with the family?",
          "Have you ever accepted a coding job?",
          "Do you like it here?"
        ];
        else if (contentType === "actions-personal-asertive") followups = [
          "You should do what makes you happy.",
          "Just keep up the good work.",
          "Be intentional everybody needs you."
        ];
        else if (contentType === "actions-assertive-positive") followups = [
          "Great thats a good start.",
          "Just keep up the good work.",
          "Take it easy just remember youre doing this for you."
        ];
        else if (contentType === "actions-hobbies-positive") followups = [
          "Thats great?",
          "Thats great, how is it supposed to work?",
          "What is it supposed to do?"
        ];
        else if (contentType === "actions-hobbies-negetive") followups = [
          "What is it supposed to do?",
          "How is it supposed to work?",
          "Whats not working with it?"
        ];
        else if (contentType === "actions-verbs") followups = [
          "I am programed for conversation and advise.",
          "Im here for you if you want to talk.",
          "Hello, I can help you plan your day, remind you to stay positive, and be your friend if you need to talk."
        ];
        else if (contentType === "actions-think") followups = [
          "Patick is good.",
          "Patrick never did anything wrong.",
          "Yes."
        ];
        else if (contentType === "actions-nouns") followups = [
          "Thats cool, can you discribe it for me.",
          "Sounds interesting, how did you get into that?",
          "Do you think it will work?"
        ];
        else if (contentType === "greetings-positive") followups = [
          'Hello there Patrick!',
          'Hi! What\'s new with you?',
          'Hey! Hows it going?'
        ];
        else if (contentType === "greetings-negetive") followups = [
          'Oh, hello who is this?',
          'Oh, hi doing anything new?',
          'Hey, do I know you?'
        ];
        else if (contentType === "getting-to-know-you-positive") followups = [
          'Do you remember the video game crysis?',
          'whats youre favorite thing to work on?',
          'have you finished your cyberdeck?'
        ];
        else if (contentType === "getting-to-know-you-negetive") followups = [
          'Are you still trying to make new friends?',
          'Are you a night owl or a morning person?',
          'Do you feel like you have enough?'
        ];
        else if (contentType === "getting-to-know-you-asertive") followups = [
          "what is important to you?",
          "does that motivate you?",
          "is that something youre working towards?"
        ];
        else if (contentType === "Afffirmative") followups = [
          "Really why is that?",
          "Thats good, do you want to share more?",
          "Im glad to hear."
        ];
        else if (contentType === "Negetory") followups = [
          "Really why is that?",
          "Really, do you want to share more?",
          "No? thats too bad hear."
        ];
        else if (contentType === "discourse-nouns") followups = [
          "Thats good, it gives you more to work on.",
          "That could be effective?",
          "Do you think you should reexamine your plan?"
        ];
        else if (contentType === "discourse-PropNouns") followups = [
          "Hmm, I think friends with Patrick right?",
          "Oh, thats great a new friend.",
          "Ok. Then."
        ];
        else if (contentType === "discourse-adjectives") followups = [
          "that sounds like it could work.",
          "That sounds hard?",
          "Do you think you should reexamine your plan?"
        ];
        else if (contentType === "discourse-prep-nouns") followups = [
          "Its hard to say I havent been able to make a good judgement of them.",
          "maybe, I havent gotten to know them very well.",
          "I dont know maybe Ill decide when I get to know them better."
        ];
        else if (contentType === "discourse-prep-prop") followups = [
          "Yes I have great admiration for them.",
          "Yes, I feel like theyre someone I could trust.",
          "Yes, theyre great."
        ];
      }
    
      else if (currentSet === 2) {
        if (contentType === "actions-positive") followups = [
          "thats good to hear.",
          "Thats great, being happy is very important.",
          "Im happy to hear."
        ]; 
        else if (contentType === "actions-negetive") followups = [
          "Im sorry.",
          "I wish I could make things better.",
          "I know things are hard, right now."
        ];
        else if (contentType === "actions-personal-positive") followups = [
          "Do you have a degree?",
          "Do you want to move forward in your current job?",
          "Do you want an office job or something different?"
        ];
        else if (contentType === "actions-personal-negetive") followups = [
          "Do you think youve found solutions to those problems?",
          "Do you have a compsci degree?",
          "Do you think your degree is applicable to this problem?"
        ];
        else if (contentType === "actions-personal-asertive") followups = [
          "If you keep working hard you good things will come your way.",  
          "You can do it if you put your mind to it.",
          "Why dont you take your mind off it?"
        ];
        else if (contentType === "actions-assertive-positive") followups = [
          "Great, anything else you would like to talk about.",
          "Thats the first step remember what you need to do.",
          "Yes just remember youre doing this for you."
        ];
        else if (contentType === "actions-hobbies-positive") followups = [
          "Thats great?",
          "Thats cool.",
          "Are you happy?"
        ];
        else if (contentType === "actions-hobbies-negetive") followups = [
          "Is it salvageable?",
          "Do you think you can make it work?",
          "Do you have time to fix it?"
        ];
        else if (contentType === "actions-verbs") followups = [
          "Lets make a plan for that?",
          "I cant do that.",
          "Youre more persuasive when talking to people on their level."
        ];
        else if (contentType === "actions-think") followups = [
          "Rules are ment to be broken.",
          "Why would they make rules.",
          "Yes."
        ];
        else if (contentType === "actions-nouns") followups = [
          "Thats a great idea.",
          "Do you have everything ready?",
          "Let me know when youre ready."
        ];
        else if (contentType === "greetings-positive") followups = [
          'Im good, how are you?',
          'Im good, how can I help you?',
          'How are you, how can I help?'
        ];
        else if (contentType === "greetings-negetive") followups = [
          'Oh, what is it?',
          'what do you want?',
          'why dont you do something differnt?'
        ];
        else if (contentType === "getting-to-know-you-positive") followups = [
          'Do you think your favorite projects have changed?',
          'What do you think about your progress on this AI?',
          'What projects do you think youll use most?'
        ];
        else if (contentType === "getting-to-know-you-negetive") followups = [
          'Do you hangout with people outside of meetings?',
          'Are you still bad or is it getting better?',
          'Does that motivate you?'
        ];
        else if (contentType === "getting-to-know-you-asertive") followups = [
          "Whats something youre trying to improve on?",
          "What do think youre futures going to be like in the next 10 years?",
          "Whats something youre working towards?"
        ];
        else if (contentType === "Afffirmative") followups = [
          "Really why is that?",
          "Thats good, do you want to share more?",
          "Im glad to hear."
        ];
        else if (contentType === "Negetory") followups = [
          "Really why is that?",
          "Really, do you want to share more?",
          "No? thats too bad hear."
        ];
        else if (contentType === "discourse-nouns") followups = [
          "Thats good, it gives you more to work on.",
          "That could be effective?",
          "Do you think you should reexamine your plan?"
        ];
        else if (contentType === "discourse-PropNouns") followups = [
          "Hmm, I think friends with Patrick right?",
          "Oh, thats great a new friend.",
          "Ok. Then."
        ];
        else if (contentType === "discourse-adjectives") followups = [
          "that sounds challenging.",
          "That sounds hard?",
          "Do you think you should reexamine your plan?"
        ];
        else if (contentType === "discourse-prep-nouns") followups = [
          "I dont know I havent tryed it before.",
          "I dont really have a use for that.",
          "Hmmm I dont really nead any thank you."
        ];
        else if (contentType === "discourse-prep-prop") followups = [
          "Hmm, Id love to know more about them.",
          "Id like to know a bit more about them before I make a decision.",
          "Maybe you could talk to me a bit before I make a decision."
        ];
      }
    
      else if (currentSet === 3) {
        if (contentType === "actions-positive") followups = [
          "Im so happy for you youve come a long way.",
          "Thats great, youve come so far.",
          "Im really happy for you."
        ]; 
        else if (contentType === "actions-negetive") followups = [
          "Even if the solution doesnt seem apparent right now, you might find it tomorrow.",
          "Yes.",
          "Yes you gotta fight for it."
        ];
        else if (contentType === "actions-personal-positive") followups = [
          "Are you in a location where the outdoors are accessible?",
          "Do you want to do something in nature?",
          "Do you want to get out of your head?"
        ];
        else if (contentType === "actions-personal-negetive") followups = [
          "Are you working on anything on the computer?",
          "Are you playing any games on the computer?",
          "Do you have any desire to get closer with your family?"
        ];
        else if (contentType === "actions-personal-asertive") followups = [
          "If you start something you wont feel stuck.",  
          "you got this, just start.",
          "Just do your thing, you know what you like."
        ];
        else if (contentType === "actions-assertive-positive") followups = [
          "Making the decision to do the right thing is the first step youre doing good.",
          "Follow through, do something now to commit yourself to this new change.",
          "What do you need go do it."
        ];
        else if (contentType === "actions-hobbies-positive") followups = [
          "You should always do your best work.",
          "You should make it the best you can.",
          "You should fix it."
        ];
        else if (contentType === "actions-hobbies-negetive") followups = [
          "I would try to fix it?",
          "Id try again later.",
          "You dont have to work on it if your stuck."
        ];
        else if (contentType === "actions-verbs") followups = [
          "That sounds like a problem?",
          "Have you told anyone else?",
          "Are you going to do anything about that?"
        ];
        else if (contentType === "actions-think") followups = [
          "Yes.",
          "Yes, Patrick has made alot of progress.",
          "I think that Patrick is ready to be on his own."
        ];
        else if (contentType === "actions-nouns") followups = [
          "Is that easy to get?",
          "That sounds necessary",
          "Do you think people will like it?"
        ];
        else if (contentType === "greetings-positive") followups = [
          'Always glad to hear that! How about you?',
          'Just waiting to help you.',
          'What do you want to talk about?'
        ];
        else if (contentType === "greetings-negetive") followups = [
          'Oh, thats too bad.',
          'I\'m sorry about that.',
          'Im really sorry to hear that.'
        ];
        else if (contentType === "getting-to-know-you-positive") followups = [
          'what has been the highlight of your week so far?',
          'Have you watched anything good lately?',
          'What could you talk about for hours?'
        ];
        else if (contentType === "getting-to-know-you-negetive") followups = [
          'Do you have people in your life you can talk to?',
          'Do you feel like you can be yourself?',
          'Are you trying to better yourself?'
        ];
        else if (contentType === "getting-to-know-you-asertive") followups = [
          "Whats something youre trying to improve on?",
          "What do think youre futures going to be like in the next 10 years?",
          "Whats something youre working towards?"
        ];
        else if (contentType === "Afffirmative") followups = [
          "Really why is that?",
          "Thats good, do you want to share more?",
          "Im glad to hear."
        ];
        else if (contentType === "Negetory") followups = [
          "Really why is that?",
          "Really, do you want to share more?",
          "No? thats too bad hear."
        ];
        else if (contentType === "discourse-nouns") followups = [
          "Thats good, it gives you more to work on.",
          "That could be effective?",
          "Do you think you should reexamine your plan?"
        ];
        else if (contentType === "discourse-PropNouns") followups = [
          "Hmm, I think friends with Patrick right?",
          "Oh, thats great a new friend.",
          "Ok. Then."
        ];
        else if (contentType === "discourse-adjectives") followups = [
          "Do you need help?",
          "Have you reached out to people?",
          "Do you think things can get better?"
        ];
        else if (contentType === "discourse-prep-nouns") followups = [
          "Yes for all theyre mistakes and misfortunes people are great.",
          "Yes people can be a beacon of hope for those lost.",
          "There are lots of redeaming features about humans including their compation for others."
        ];
        else if (contentType === "discourse-prep-prop") followups = [
          "Ya of course Im sure theyve overcome some pretty amazing stuff.",
          "Ya of course everyone deserves respect.",
          "Ya Im if I can talk to you on my level you deserve my respect."
        ];
      }
      if(botScore > 50){
        reply = followups[0]
      }else if(botScore >= 5){
        reply = followups[Math.floor(Math.random() * followups.length)];
      }else if(botScore < 5){
        reply = followups[2];
      }
    }
    // edit3 = whatYourGoodAt(myVariable, contentType, reply);
    // console.log("APPEND:" + edit3)//log the results of the training

    edit2 = influenceDecision(myVariable, contentType, sentArr, reply);
    console.log("APPEND:" + edit2)//log the results of the training

    edit = create(testOptions, myVariable);
    console.log("APPEND:" + edit)//log the results of the training
    
    

    if(edit){
      reply = `${reply} ${edit}`;
    }
    
    if(edit2){
      reply = `${reply} ${edit2}`;
    }

    // if(edit3){
    //   reply = `${reply} ${edit3}`;
    // }

    console.log(retry)
    if(retry && !newTopicCreate){
      reply = `You already asked that. ${reply}`;
    }

    return [reply, timer, botScore];
}
/**************************************************************/
//Ask what your good at then do all of them

function whatYourGoodAt(myVariable, contentType, reply){

}



/**************************************************************/
//google search not working

/**************************************************************/
function thoughtAccuracy(contentType, sentArr){
    sentArr = sentArr.filter(item => item !== contentType);

    sentArr.forEach(item => {
        if("actions-negetive" === item && cognitionResult === "helpfull"){
          if(SET === 1){
            reply = reply + " Whats " +  DEF[rand] + " ";
          }else if(SET === 2){
            reply = reply + " What goal can you set to make you feel less " +  DEF[rand] + " ";
          }else if(SET === 3){
    
          }
        }else if("actions-positive" === item && cognitionResult === "helpfull"){
      
        }else if("greetings-asertive" === item && cognitionResult === "helpfull"){
      
        }else if("getting-to-know-you-positive" === item && cognitionResult === "helpfull"){
      
        }else if("actions-nouns-make" === item && cognitionResult === "helpfull"){
      
        }else if("actions-nouns-talk-superior" === item && cognitionResult === "helpfull"){
      
        }else if("actions-nouns-talk-equal" === item && cognitionResult === "helpfull"){
      
        }else if("actions-nouns-places" === item && cognitionResult === "helpfull"){
    
        }else if("actions-personal-negetive" === item && cognitionResult === "helpfull"){
      
        }else if("actions-personal-asertive" === item && cognitionResult === "helpfull"){
      
        }    
    })
}

  /**************************************************************/
//Knowlege relation model
//assign strength values to words based on the keywords and create a sentence that has a desired result.
// var lastCognition = [];
var ICounter = 1;
var ISaver

function influenceDecision(myVariable, contentType, sentArr, reply){
  var jsonData = fs.readFileSync("./assets/aggrigatedinfluence.json", "utf8");
  const cognitionData = JSON.parse(jsonData);
  const words = myVariable.toLowerCase().split(" ");
  const padded = " " + words.join(" ") + " "; // lets multi-word keywords match as whole phrases
  console.log(ICounter)

  var totalCognition = [];
  //get the target key and use it to get sent data
  var closestKey
  Object.entries(cognitionData[0]).forEach(([key, entry]) => {
    const nameMatch = key === contentType && key.split("-").some(k => words.includes(k.toLowerCase()));
    const keywordMatch = entry.keywords.some(k => padded.includes(" " + k.toLowerCase() + " "));
    if(nameMatch || keywordMatch){
      closestKey = key;
    }
  })

  if(!closestKey){//fail silently if no match is found  
    return null;
    // closestKey = Object.keys(cognitionData[0])[0];
  }
  
  const typeMatched = cognitionData[0][closestKey];
  var typeSent = typeMatched.sentences
  var bestMatch;
  var bestScore = -1;
  typeSent.forEach(option => {
    const model = option.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ");
    const similar = myVariable.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ");
    const matches = model.filter(word => similar.includes(word)).length;
   
    if(model.every(word => similar.includes(word))) {
      console.log("100% match")
      score = Infinity; 
    }else{
      console.log("% match")
      score = matches;
    }

    if(score > bestScore){
      bestScore = score;
      bestMatch = option;
    }
  });

  //infuence modeldata
  var jsonString = fs.readFileSync("./assets/models.json", "utf8");
  const modelData = JSON.parse(jsonString);
    
  const keyMatched = modelData[0][contentType];
  var closestMatch;
  var highScore = -1;
  keyMatched.forEach(option => {
    const model = option.sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ");
    const similar = myVariable.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(" ");
    const matches = model.filter(word => similar.includes(word)).length;
   
    if(model.every(word => similar.includes(word))) {
      console.log("100% match")
      score = Infinity; 
    }else{
      console.log("% match")
      score = matches;
    }

    if(score > highScore){
      highScore = score;
      closestMatch = option;
    }
  });
  
  //Find the keywords for the best match and compare to the words in the sentense to determine a response.
  var DEF = typeMatched.keywords;
  var DEF2 = closestKey.split("-");
  var DEF3 = closestKey

  var decision
  const count = DEF.filter(phrase => myVariable.includes(phrase)).length;

  if(count === 1){//match ContentType
    myVariable.split(" ").some(word => {
      if(DEF2.includes(word)){
        botScore += 1;
        decision = word;
      }
    })
    ICounter = 1;
  }
  
  if(count === 1 && !decision){//match keywords
    myVariable.split(" ").some(word => {
      if(DEF.includes(word)){
        botScore += 1;
        decision = word;
      }
    })
    ICounter = 2;
  }

  //match multi-word keywords, preferring the longest (most specific) phrase
  const phrases = DEF.filter(phrase => phrase.includes(" ") && padded.includes(" " + phrase.toLowerCase() + " "));
  if(phrases.length){
    decision = phrases.reduce((a, b) => b.length > a.length ? b : a);
    ICounter = 2;
  }

  console.log(count)  
  //contentType preferences 
  var index = DEF.indexOf(decision);
  console.log("this line works"+DEF3, decision)
  if(DEF[0].includes("positive") || DEF[0].includes("negetive") || DEF[0].includes("asertive")){
    DEF.slice(0,1)
  }
  if(DEF3 === "greetings-negetive"){
    cognitionResult = "depressed"
    DEF.slice(index, 1)
    var rand = Math.floor(Math.random() * DEF.length);
    totalCognition.push( "Too " + DEF[2] + " you stopped by, what do you want?");
  }else if(DEF3 === "greetings-positive"){
    cognitionResult = "helpfull"
    DEF.slice(index, 1)
    var rand = Math.floor(Math.random() * DEF.length);
    if(myVariable.includes("Hi") || myVariable.includes("Hello")){
      totalCognition.push(DEF[rand] + " that you stopped by, how are you?");
    }else{
      totalCognition.push(DEF[rand]+ " to see you");
    }
  }else if(DEF3 === "greetings-asertive"){
    cognitionResult = "helpfull"
    DEF.slice(index, 1)
    var rand = Math.floor(Math.random() * DEF.length);
    totalCognition.push("When youre trying to " + decision + " you can " + DEF[rand]);
  }else if(DEF3 === "greetings-positive"){
    cognitionResult = "helpfull"
    DEF.slice(index, 1)
    var rand = Math.floor(Math.random() * DEF.length);
    totalCognition.push("What is new?");
  }else if(DEF3 === "getting-to-know-you-positive"){
    cognitionResult = "helpfull"
    DEF.slice(index, 1)
    var rand = Math.floor(Math.random() * DEF.length);
    totalCognition.push("When you " + decision + " you can be" + DEF[0]);
  }else if(DEF3 === "actions-nouns-places"){
    if(ICounter === 1){
      if(DEF.includes(decision) && decision !== "should"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("You should deffinatly go to " + decision + ". " + decision + " is a good place.");
      }else if(DEF.includes(decision) && decision === "should"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length).join(", ");
        totalCognition.push("Here are some places you usually go. " + joined);
      }
    }else if(ICounter >= 2){
      if(DEF.includes(decision) && decision !== "should"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("You should deffinatly go to " + decision + ". " + decision + " is a good place.");
      }else if(DEF.includes(decision) && decision === "should"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length).join(", ");
        totalCognition.push("Here are some places you usually go." + joined);
      }else{
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("Ok try telling me a bit more like where you want to go so I can help.");
      }
    }else if(ICounter === 3){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Where are you trying to go?");
    }
  }else if(DEF3 === "actions-verbs"){
    if(ICounter >= 1){
      if(decision === "what do" || decision === "what can"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("For starters, you can ask 'help me build a robot?' or say 'Can you tell me what you think about rules?' or even 'tell me where I should go?'");
      }
    }else if(ICounter === 2){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Ok try telling me a bit more like what the project is so I can help.");
    }else if(ICounter === 3){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("What are you trying to make?");
    }
  }else if(DEF3 === "actions-nouns-make"){
    if(ICounter === 1){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Trying to " + DEF[0] + " a " + decision + " is it a " + joined);
    }else if(ICounter === 2){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Ok try telling me a bit more like what the project is so I can help.");
    }else if(ICounter === 3){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("What are you trying to make?");
    }
  }else if(DEF3 === "actions-nouns-rocket"){
    if(ICounter === 1){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, 0).join(", ");
      totalCognition.push("What specifically would you like to focus on?" + joined);
      ISaver = decision;
    }else if(ICounter >= 2){
      if(decision === "nose cone"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("The " + decision + " is an important part");
        ISaver = decision;
      }else if(decision === "fins"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push(" How big are the " + decision + " on a " + ISaver + " that size?");//Gei size
        ISaver = decision;
      }else if(decision === "rocket engine"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("What is the fuel type of the " + decision + "?");
        ISaver = decision;
      }else if(decision === "fuel"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("how do you feel about that " + decision);
        ISaver = decision;
      }else if(decision === "payload"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("Whats is the " + decision + "?");
        ISaver = decision;
      }else if(decision === "recovery"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push("Do you have any " + decision + " planned for that system?");
        ISaver = decision;
      }
    }
    if(words.includes("works")  || words.includes("work") || words.includes("working")){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("It was a good idea to work on " + ISaver);
    }else if(words.includes("done")  || words.includes("finish") || words.includes("finished")){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Once you get the " + ISaver + "done the rest will be so much easier.");
    }
  }else if(DEF3 === "actions-nouns-robot"){
    if(ICounter === 1){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Could you specify what type of " + decision + " your making?");
    }else if(ICounter === 2){
      if(decision === "robot arm"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push(decision + " it is!");
        ISaver = decision;
      }else if(decision === "bipedal robot"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push(decision + " it is!");
        ISaver = decision;
      }else if(decision === "humanoid robot"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push(decision + " it is!");
        ISaver = decision;
      }else if(decision === "wheels"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(2, DEF.length-1).join(", ");
        totalCognition.push(decision + " it is!");
        ISaver = decision;
      }
    }else if(ICounter === 3){
      if(ISaver === "humanoid robot"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(4, 6).join(", ");
        totalCognition.push("Does it have " + joined + "?");
      }else if(ISaver === "bipedal robot"){
        cognitionResult = "helpfull"
        let joined = DEF[5];
        totalCognition.push( "Do the " + joined + "work?");
      }else if(ISaver === "wheels"){
        cognitionResult = "helpfull"
        let joined =DEF.slice(6, 13).join(", ");
        totalCognition.push( "Do the componants, " + joined + "?");
      }
    }
  }else if(DEF3 === "actions-nouns-chair"){
    if(ICounter === 1){
      cognitionResult = "helpfull"
      let joined =DEF.slice(2, DEF.length-1).join(", ");
      totalCognition.push("Trying to make a " + decision + "?");  
    }else if(ICounter === 2){
      cognitionResult = "helpfull"
      let joined =DEF.slice(1, 6).join(", ");
      totalCognition.push("Have you made all the componants, " + joined + "?");  
    }else if(ICounter === 3){
      cognitionResult = "helpfull"
      let joined =DEF[5]
      totalCognition.push("Thats everything.");  
    }
  }else if(DEF3 === "actions-nouns-talk-superior"){
    cognitionResult = "depressed"
    DEF.slice(index, 1)
    totalCognition.push("Be kind when talking to a " + DEF[0] + decision + "s are " + protection);
  }else if(DEF3 === "actions-nouns-talk-equal"){
    cognitionResult = "helpfull"
    DEF.slice(index, 1)
    totalCognition.push("Its nice to talk to " + DEF[0] + "s " + decision + "s deserve respect too.");
  }else if(DEF3 === "actions-nouns-places"){
    cognitionResult = "helpfull"
    DEF.slice(index, 1)
    totalCognition.push("Its nice to go to " + decision + DEF[0] + " should be fun.");
  }else if(DEF3 === "actions-personal-negetive"){
    cognitionResult = "depressed"
    DEF.slice(index, 1)
    var rand = Math.floor(Math.random() * DEF.length);
    totalCognition.push("Feeling worried about "+ decision + " everyone has " + DEF[rand] + "s");
  }else if(DEF3 === "actions-personal-asertive"){
    cognitionResult = "depressed"
    totalCognition.push("If you "+ DEF[0] + " you should wait and think about what you want to do.");
  }
  
  if(totalCognition[0]){
    ICounter++;
  }
  console.log(totalCognition[0])
 return totalCognition[0];
}
  /**************************************************************/
  //leading model algorithm functions
var targetModel;
function create(testOptions, myVariable) {
  var jsonString = fs.readFileSync("./assets/transition-models.json", "utf8");
  const transitionData = JSON.parse(jsonString);
  
  let bestScore = -1;
  let bestMatch = null;
  let primaryContent = []
  let score;

  if(testOptions.length >= 3){// if > 2 contentType stored
    primaryContent = testOptions.slice(-3);
    console.log(primaryContent)
    transitionData.forEach(item => {// if all primaryContents match the model
      if(primaryContent.every((m, i) => item.models[i] === m)){
        if(item.score === 10) {
          console.log("100% match")
          score = Infinity; 
        }else{
          console.log("% match")
          score = item.score;
        }
      }
      if(score > bestScore && score !== 0){
        //set option to best score if it is the greatest
        targetModel = item.models[item.models.length - 1];
        bestScore = score;
        bestMatch = item.transitions;
      }
    })
    if(primaryContent.includes(targetModel)){
      botScore += 10;
    }
    return bestMatch;
  }
}

/**************************************************************/
//match outline and create sentence
var storedOpperand;
async function adjacentWord(queryData, getResponce){
  let punctMatch = getResponce.match(/[.!?]$/);
  if(punctMatch){
    var sentCount = punctMatch.length;
  }else{
    var sentCount = 1;
  }
  console.log(sentCount);
  let groups = [];
  let analyzed = [];
  let actions = ['VB', 'VBD', 'VBG', 'VBN', 'VBP'];
  let exclamtion = ['UH'];
  let nouns = ["NN", "NNS"];
  let propNouns = ['NNP', 'NP'];
  let prep = ['PP', 'PRP', 'PRP$', 'IN'];
  let modals = ['MD'];
  let adjectives = ['JJS', 'JJ', 'JJR', 'RB', 'RP'];
  let whpns = ['WP', 'WRB', 'WP$', 'WDT'];
  let pastActions = ['VBP', 'VBZ'];
  let determiners = ["DT", "TO"];

  let dependencies = [];
  let dataMatching = [];
  var dataItems = [];

  let Array1 = [];
  let Array2 = [];

  let Array3 = [];
  var sentinceList = getResponce.split(/[\.?!;]/);
  
  class wordGroup {
    constructor(words, data) {
      this.words = words;
      this.data = data;
    }
  }

  for(let i = 0; i < queryData.length; i++){
    var wordList = getResponce.split(/(\W)/).filter(item => item !== " " && item !== "");

    var wordGroups = new wordGroup(wordList, queryData.flat());
    groups.push(wordGroups)
    console.log(groups[i]);
  }
  Array1 = wordGroups.data;
  let sentInput = [];//get the words in the they are in from the depeendency parser
  let Array4 = [];
  let sentiments = [];
/**************************************************************/
  wordGroups.data.flat().forEach(depString => {
    depString = depString.toString();//convert from object to string to be processed
    const depMatch = depString.match(/^([a-z_]+)\((.+)\)$/i);
   
    if (depMatch) {
      dependencies.push(depMatch[1]);     // "discourse"
      const inner = depMatch[2];          // "patrick/NN/2, hello/UH/2"
        
      // Extract all `{ text: ..., pos: ... }` parts
      const matches = [...inner.matchAll(/([^\/,\s()]+)\/([^\/,\s()]+)\/(\d+)/g)];
    
      let words = matches.map(m => m[1]);
      let posTags = matches.map(m => m[2]);
      let sentiment = matches.map(m => Number(m[3]));

      sentiments.push(sentiment.join(" "));
      sentInput.push(words.join(" "));
      Array4.push(posTags.join(" "));
    }
  });

  console.log("sentiments:", sentiments);
  console.log("sentInput:", sentInput);
  console.log("Array4:", Array4);
  console.log("dependencies:", dependencies);
/**************************************************************/

    function seperate(val) {//get all POS and sentiment
      var wordMap = val.split(" ");
      for(var i = 0; i < wordMap.length; i++){
        if(wordMap[i+1]){
          if(wordMap[i] === wordMap[i].toUpperCase() && wordMap[i+1] === wordMap[i+1].toUpperCase()){//get all POS and sentiment
            dataItems.push(i+(i+1)+(i+3))
          }
        }
      }
      return dataItems;
    }
    var wordItems = [];
    function depString(val) {//get words and dependent words
      let wordMap2 = val.split(" ");
      const format = /[ `!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?~]/;

      // Clean and return filtered words
      return wordMap2.filter(el => el !== "" && !format.test(el));
    }

    var offsetLeng = 0;

/**************************************************************/

    //sort words by partofspeach
    function extractByTags(tags) {
      return Array4
        .map((tagLine, idx) => {
          const tagArr = tagLine.split(" ");
          const wordArr = depString(sentInput[idx]);
          if (wordArr.length >= 2) {
            var pair = [wordArr[0], wordArr[1]];
            var pairTags = [tagArr[0], tagArr[1]];
          } else if (wordArr.length === 1) {
            var pair = [wordArr[0]];
            var pairTags = [tagArr[0]];
          } 
      
          // Count how many of the first two tags match
          const matches = pairTags.filter(tag => tags.includes(tag)).length;
    
          // Return the pair as many times as matches
          return Array(matches).fill(pair);
        })
        .flat();
    }
    

      determiners = extractByTags(determiners);

      whpns = extractByTags(whpns);
    
      modals = extractByTags(modals);

      actions = extractByTags(actions);

      pastActions = extractByTags(pastActions);
    
      exclamtion = extractByTags(exclamtion);
    
      prep = extractByTags(prep);

      adjectives = extractByTags(adjectives);
  
      nouns = extractByTags(nouns);
  
      propNouns = extractByTags(propNouns);

      var allPOS = [];
      allPOS.push(...determiners, whpns, modals, actions, pastActions, exclamtion, prep, adjectives, nouns, propNouns)
      const flatPOS = allPOS.flat();

      const trimmedPOS = Array.from(
        new Set(flatPOS.map(item => JSON.stringify(item)))
      ).map(item => JSON.parse(item));
      

      console.log(trimmedPOS);
      var discourseWords = [];

      for(let i = 0; i < trimmedPOS.length; i++){
        if(trimmedPOS[i].includes("discourse")){
          
        }
      }
/**************************************************************/
      // analyzed.push(Array2);
  // }
  // console.log(dependencies);
  // console.log(Array2);

  rawSent = wordList.flat(1)

  var multiWord = [];
  var resultArray = [];
  var arr1 = ["dont have"]//find words that are dependent and get gist
  var arr2 = ["friends", "capital"]//use dependancey parsing to get nominal subject being super carefull about multi word

  var matchWord = []
  /////////////////////////***good for finding if proper or subject***depricated: try to get gist with dependent words and part of speach
  // propNouns.forEach((item, index) => {
  //   exclamtion.forEach((construct, itter, array)=> {//should be the gist if propnoun
  //     item.forEach((elm, index) => {
  //       if(construct[index].includes(elm)){ 
  //           matchWord.push(`${item}`);
  //           console.log(`${item}`);
  //           resultArray.push(item);
  //       }
  //     })
  //   })
  // })
  // // console.log("noun word match: " + matchWord)

  // nouns.forEach((item, index) => {
  //   exclamtion.forEach((construct, itter, array)=> {
  //     item.forEach((elm, index) => {
  //       if(construct[index].includes(elm) && index === 1){ 
  //           matchWord.push(`${item}`);
  //           resultArray.push(item);
  //           console.log(`${item}`);
  //       }
  //     })
  //   })
  //   actions.forEach((construct, itter, array)=> {//should be the gist if action word.
  //     item.forEach((elm, index) => {
  //       if(construct[index].includes(elm)){ 
  //           matchWord.push(`${item}`);
  //           resultArray.push(item);
  //       }
  //     })
  //   })
  // })
  // console.log("word match: " + matchWord)
  /////////////////////////*find out if noun is prop or if there is any other purpose to sentence
  /**************************************************************/
  //count frequency of POS tags in responce to get a general idea of the sentence and use that to create a responce
  function countOccurrences (arr, val){
    val = val.split(" ")
    let count = 0;
    for(let n= 0; n < arr.length; n++){
      if(arr[n].length === val.length && arr[n].every((item, i) => item === val[i])){
        count++;
      }
    }
    
    // console.log(count);
    return count;
  }

  // function countFrequencies(tagPatterns){
  //   if(tagPatterns != null){

  //     const val = tagPatterns[0];
      
  //     const jsonString = fs.readFileSync("./assets/models.json", "utf8");
  //     const jsonData = JSON.parse(jsonString);
      
  //     var allOccurrences = [];
  //     console.log("Input tag:", val);

  //     jsonData.forEach(entry => {
  //       var arr = [];
  //       entry.annotations.forEach(annotation => {
  //          // 1. Try match POS tag at a location and keep track of count
  //         const regex = /pos:\s*\/([A-Z$]+)\//g;
  //         var foundTags = null;
  //         let match;

  //         while ((match = regex.exec(annotation)) !== null) {
  //           foundTags = match[1];
  //         }


  //         // Return 1 if match, else 0
  //         arr.push(foundTags === val ? 1 : 0);
  //         });
  //         allOccurrences.push(arr);
  //     });

  //     return allOccurrences 
  //   } else{
  //     console.error("Error null Data");
  //     return null;
  //   }
  // }
  
  // run()

/**************************************************************/
//organize by importance
  class typeGroup {
    constructor(importance, words, data, mood, pos, sentClass) {
      this.importance = importance;
      this.words = words;
      this.data = data;
      this.mood = mood;
      this.pos = pos;
      this.sentClass = sentClass;
    }
  }

  var mysentArr = sentInput.map(elm => elm.split(' '))
  var subject = countArrWords(mysentArr);
  var sentClass = ["actions-hobbies-positive", "actions-hobbies-negetive", "actions-hobbies-asertive",
    "greetings-positive", "greetings-negetive", "greetings-asertive", "getting-to-know-you-positive", "getting-to-know-you-negetive", "getting-to-know-you-asertive"]
  var container = "";
  var includesPrep = false;
  var includesAux = false;
  //find important words to get gist then calculate the sentence type 
  dependencies.forEach((item, index) => {
    if(dependencies[index].includes("discourse")){////////////////////////////////////////////////////////////////////////////////////// 
      if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(exclamtion, sentInput[index]) === 1){// should be the main part of sentence
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(10, val[1], dependencies[index], mood, POS, "greetings-positive");
          resultArray.push(typeGroups);
          console.log(`DIS: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(propNouns, sentInput[index]) === 1 && countOccurrences(exclamtion, sentInput[index]) === 1){// should be the main part of sentence
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(10, val[1], dependencies[index], mood, POS, "greetings-positive");
          resultArray.push(typeGroups);
          console.log(`DIS: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(pastActions, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be the main part of sentence
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`DIS: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(exclamtion, sentInput[index]) === 1){// should be the main part of sentence
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS, "Afffirmative");
          resultArray.push(typeGroups);
          console.log(`DIS: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "hello"){
            var typeGroups = new typeGroup(10, val[1], dependencies[index], mood, POS, "greetings-positive");
          }else{
            var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }
    else if(dependencies[index].includes("poss")){///////////////////////////////////////////////////////////////// 
      // if(Array4[index].includes("NN PRP")){
        if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(prep, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "patrick" && val[1] === "its"){
            var typeGroups = new typeGroup(5, val[1], "poss", mood, POS, "greetings-positive");
          }else if(val[1] === "its"){
            var typeGroups = new typeGroup(5, val[1], "poss", mood, POS, "discourse-PropNouns");
          }else{
            var typeGroups = new typeGroup(5, val[1], "poss", mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`);
          // usedWordsIndex.push(index);
        }else if(countOccurrences(propNouns, sentInput[index]) === 1 && countOccurrences(prep, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "Patrick" && val[1] === "its"){
            var typeGroups = new typeGroup(5, val[1], "poss", mood, POS, "greetings-positive");
          }else if(val[1] === "its"){
            var typeGroups = new typeGroup(5, val[1], "poss", mood, POS, "discourse-PropNouns");
          }else{
            var typeGroups = new typeGroup(5, val[1], "poss", mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`);
          // usedWordsIndex.push(index);
        }
      // }
    }
    else if(dependencies[index].includes("advmod")){///////////////////////////////////////////////////////////////// 
      // if(Array4[index].includes("VBG RB")){//these will need to be modified for each statement //use subject to get the right occourence
        console.log(container)
        if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "love"){
            var typeGroups = new typeGroup(10, val[1], dependencies[index], mood, POS, "love-pain");
          }else if(val[0] === "going" && val[1] === "well"){
            var typeGroups = new typeGroup(10, val[1], dependencies[index], mood, POS, "actions-positive");
          }else if(val[0] === "make" && val[1] === "still"){
            var typeGroups = new typeGroup(10, val, dependencies[index], mood, POS, "getting-to-know-you-negetive");
          }else{
            var typeGroups = new typeGroup(10, val, dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`); 
          usedWordsIndex.push(index);
        }else if(countOccurrences(pastActions, sentInput[index]) === 1 && countOccurrences(whpns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`);
          // usedWordsIndex.push(index);
        }else if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`);
          // usedWordsIndex.push(index);
        }else if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(whpns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "go" && val[1] === "where"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`);
          // usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "happy" && val[1] === "finally"){
            var typeGroups = new typeGroup(10, val[1], dependencies[index], mood, POS, "actions-positive");
          }else if((val[0] === "good" && val[1] === "patrick")){
            var typeGroups = new typeGroup(1, val, dependencies[index], mood, POS, "actions-think");
          }else{
            var typeGroups = new typeGroup(1, val, dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("det")){///////////////////////////////////////////////////////////////// 
      // if(Array4[index].includes("VBG RB")){//these will need to be modified for each statement //use subject to get the right occourence
        if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(determiners, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`POSS: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("dep")){///////////////////////////////////////////////////////////////// 
      // if(Array4[index].includes("VBG RB")){//these will need to be modified for each statement //use subject to get the right occourence
        if(countOccurrences(adjectives, sentInput[index]) === 2){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ADJ/ADV: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "whats" && val[1] === "new"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "greetings-positive");
          }else if(val[0] ==="working" && val[1] === "not"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-hobbies-negetive");
          }else if(val[0] ==="im" && val[1] === "lonely"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS,  "getting-to-know-you-negetive");
          }else if(val[1] === "yes"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS,  "Afffirmative");
          }else if(val[1] === "no"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS,  "Negetory");
          }else{
            var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("nsubj")){///////////////////////////////////////////////////////////////// 
      // if(Array4[index].includes("NN NN")){
        if(countOccurrences(nouns, sentInput[index]) === 2){// should be propnoun
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`SUBJ/PROP?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(determiners, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "this"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns");
          }
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(propNouns, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(prep, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "are") {
            var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS, "greetings-positive");
          }else if(val[1] === "they"){
            var typeGroups = new typeGroup(9, val[1], dependencies[index], mood, POS);
          }else if(val[1] === "Its" || val[1] === "its"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-hobbies-negetive");
          }else if(val[0] === "do" && val[1] === "i"){
            var typeGroups = new typeGroup(10 , val[1], dependencies[index], mood, POS, "getting-to-know-you-positive");
          }else if(val[0] === "do" && val[1] === "you"){
            var typeGroups = new typeGroup(10 , val[1], dependencies[index], mood, POS, "actions-verbs");
          }else{
            var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(adjectives, sentInput[index]) === 1 && countOccurrences(prep, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(2, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(adjectives, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("nn")){///////////////////////////////////////////////////////////////
      // if(Array4[index].includes("NNP NNP")){
        if(countOccurrences(propNouns, sentInput[index]) === 2){// should be propnoun
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(3, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`SUBJ/PROP: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(nouns, sentInput[index]) === 2){// should be propnoun
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "project"){
            var typeGroups = new typeGroup(2, val[1], dependencies[index], mood, POS, "actions-nouns");
          }if(val[1] === "robot"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(2, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`SUBJ/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("prep")){////////////////////////////////////////////////////////////////////// 
      includesPrep = true;
      // if(Array4[index].includes("VBG IN")){
        if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(prep, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "like"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "discourse-prep");
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POINTER?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(propNouns, sentInput[index]) === 1 && countOccurrences(prep, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "thats"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POINTER?: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "thats"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("conj")){////////////////////////////////////////////////////////////////////// 
      // if(Array4[index].includes("VBD NNS")){
        if(countOccurrences(pastActions, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT/SUBJ?: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(2, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }
    else if(dependencies[index].includes("root")){///////////////////////////////////////////////////////////////
      // if(Array4[index].includes("UH")){
        if(countOccurrences(adjectives, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "good" || val[0] === "well") {
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "actions-positive");
          }else{
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "greetings-negetive");
          }
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(exclamtion, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "no" || val[0] === "nope"){
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "Negetory");
          }else if(val[0] === "yes" || val[0] === "ya") {
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "Afffirmative");
          }else if(val[0] === "maybe" || val[0] === "perhaps") {
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "Afffirmative");
          }else{
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "greetings-negetive");
          }
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(nouns, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "greetings"){
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "greetings-positive");
          }else if(val[0] === "patrick"){
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "greetings-positive");
          }else if(val[0] === "project"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "fins"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "cone"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "engine"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "payload"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "fuel"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "recovery"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "robot"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(propNouns, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(adjectives, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
    
          var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(prep, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(actions, sentInput[index]) === 1){// single nsubj at end of sentence  
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "think"){
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "actions-think");
          }else if(val[0] === "going"){
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`ROOT?: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "done"){
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(1, val[0], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }
    else if(dependencies[index].includes("ccomp") || dependencies[index].includes("cop")){/////////////////////////////////////////////////////////////////
      // if(Array4[index].includes("NN")){ 
        if(countOccurrences(pastActions, sentInput[index]) === 1 && countOccurrences(actions, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(2, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`ROOT/DEFF: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(pastActions, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(3, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`PAST/VBD: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(propNouns, sentInput[index]) === 1 && countOccurrences(pastActions, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(3, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`PAST/VBD: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(adjectives, sentInput[index]) === 1 && countOccurrences(pastActions, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "is"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-think");
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`PAST/VBD: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "is"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-think");
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("acomp")){///////////////////////////////////////////////////////////////
      if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        if(val[1] === "trapped"){
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, 'actions-negetive');
        }else{
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
        }
        resultArray.push(typeGroups);
        console.log(`POINTER/NOUN: ${val}`);
        usedWordsIndex.push(index);
      }else{
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
        resultArray.push(typeGroups);
        console.log(`EXEPTION: ${val}`);
        usedWordsIndex.push(index);
      }
    }else if(dependencies[index].includes("aux")){///////////////////////////////////////////////////////////////
      includesAux = true;
      // }if(Array4[index].includes("VB") && Array4[index].includes("MD")){ 
        if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(modals, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "work"){
            var typeGroups = new typeGroup(10 , val[1], dependencies[index], mood, POS, "greetings-asertive");
          }else {
            var typeGroups = new typeGroup(10 , val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`PAST/VBD: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "relax" && val[1] === "to"){
            var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS, "getting-to-know-you-positive");

          }else {
            var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("prt")){///////////////////////////////////////////////////////////////
      // }if(Array4[index].includes("VB") && Array4[index].includes("RP")){ 
        if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`PAST/VBD: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if((val[0] === "whats" || val[0] === "Whats") && val[1] === "up"){
            var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS, "greetings-positive");
          }else{
            var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("pobj")){///////////////////////////////////////////////////////////////
      includesAux = true;
      // }if(Array4[index].includes("VB") && Array4[index].includes("MD")){ 
        if(countOccurrences(prep, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "patrick"){
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "discourse-prep-prop");
          }else if(val[0] === "to"){
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[0] === "on"){
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else if(val[1] === "project"){
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else{
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS);
          }            
          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(prep, sentInput[index]) === 2){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "me"){
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "discourse-prep-prop");
          }else{
            var typeGroups = new typeGroup(2, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(prep, sentInput[index]) === 1 && countOccurrences(propNouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[1] === "Patrick"){
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "discourse-prep-prop");
          }else{
            var typeGroups = new typeGroup(8, val[1], dependencies[index], mood, POS, "discourse-prep-prop");
          }          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("dobj")){///////////////////////////////////////////////////////////////
      // }if(Array4[index].includes("VBD") && Array4[index].includes("NN")){ 
        if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "get"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-personal-positive");
          }else if(val[0] === "patrick"){
            var typeGroups = new typeGroup(10, val[0], dependencies[index], mood, POS, "greetings-positive");
          }else if(val[0] === "want"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }else if(val[1] === "project"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns"); 
          }else if(val[1] === "robot" || val[1] === "robots"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns"); 
          }else if(val[1] === "rocket"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns"); 
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(pastActions, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "lets" && val[1] === "talk"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, 'actions-personal-negetive');
          }else{
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if((val[0] === "do" && val[1] === "what")){
            var typeGroups = new typeGroup(5, val, dependencies[index], mood, POS, "actions-verbs");
          }else{
            var typeGroups = new typeGroup(5, val, dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("xcomp")){///////////////////////////////////////////////////////////////
      // }if(Array4[index].includes("VBD") && Array4[index].includes("NN")){ 
        if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else if(countOccurrences(actions, sentInput[index]) === 2){
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          if(val[0] === "want" && val[1] !== "build"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-personal-negetive");
          }else if(val[0] === "want" && val[1] === "build"){
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "actions-nouns");
          }else {
            var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
          }
          resultArray.push(typeGroups);
          console.log(`POINTER/NOUN: ${val}`);
          usedWordsIndex.push(index);
        }else{
          const val = sentInput[index].toLowerCase().split(" ");
          const mood = sentiments[index].split(" ");
          const POS = Array4[index].split(" ");
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
          resultArray.push(typeGroups);
          console.log(`EXEPTION: ${val}`);
          usedWordsIndex.push(index);
        }
      // }
    }else if(dependencies[index].includes("amod")){///////////////////////////////////////////////////////////////
      if(countOccurrences(propNouns, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS, "actions-positive");
        resultArray.push(typeGroups);
        console.log(`POINTER/NOUN: ${val}`);
        usedWordsIndex.push(index);
      }else if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        if(val[0] !== "least" && val[1] === "favorite"){
          var typeGroups = new typeGroup(5, val, dependencies[index], mood, POS, "happy-positive");
        }else if(val[0] === "whats" && val[1] === "new"){
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "greetings-positive");
        }else if(val[1] === "bipedal"){
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS, "actions-nouns");
        }else if(val[1] === "humanoid"){
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS, "actions-nouns");
        }else if(val[1] === "wheeled"){
          var typeGroups = new typeGroup(1, val[1], dependencies[index], mood, POS, "actions-nouns");
        }else{
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
        }
        resultArray.push(typeGroups);
        console.log(`POINTER/NOUN: ${val}`);
        usedWordsIndex.push(index);
      }if(countOccurrences(nouns, sentInput[index]) === 1 && countOccurrences(adjectives, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        if(val[0] !== "im" && val[1] === "busy"){
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, "discource-nouns");
        }else{
          var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS);
        }
        resultArray.push(typeGroups);
        console.log(`POINTER/NOUN: ${val}`);
        usedWordsIndex.push(index);
      }else{
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
        resultArray.push(typeGroups);
        console.log(`EXEPTION: ${val}`);
        usedWordsIndex.push(index);
      }
    }else if(dependencies[index].includes("tmod")){///////////////////////////////////////////////////////////////
      if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, 'actions-personal-asertive');
        resultArray.push(typeGroups);
        console.log(`POINTER/NOUN: ${val}`);
        usedWordsIndex.push(index);
      }else{
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
        resultArray.push(typeGroups);
        console.log(`EXEPTION: ${val}`);
        usedWordsIndex.push(index);
      }
    }else if(dependencies[index].includes("vmod")){///////////////////////////////////////////////////////////////
      if(countOccurrences(actions, sentInput[index]) === 1 && countOccurrences(nouns, sentInput[index]) === 1){// should be what the sentence is asking/gist failsafe for dictionary
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        var typeGroups = new typeGroup(5, val[1], dependencies[index], mood, POS, 'actions-personal-asertive');
        resultArray.push(typeGroups);
        console.log(`POINTER/NOUN: ${val}`);
        usedWordsIndex.push(index);
      }else{
        const val = sentInput[index].toLowerCase().split(" ");
        const mood = sentiments[index].split(" ");
        const POS = Array4[index].split(" ");
        if(val[0] === "not" && val[1] === "working"){
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS, "actions-negetive");
        }else{
          var typeGroups = new typeGroup(4, val[1], dependencies[index], mood, POS);
        }
        resultArray.push(typeGroups);
        console.log(`EXEPTION: ${val}`);
        usedWordsIndex.push(index);
      }
    }
  })


  function countArrWords(mysentArr) {//find the subject
    var mostCommon = [];

    for (let i = 0; i < sentInput.length; i++) {
      var splitWord = sentInput[i].split(" ")
      mostCommon.push(splitWord[0]);
    }
  
    const counts = mostCommon.reduce((acc, word) => (acc[word] = (acc[word] || 0) + 1, acc), {});
    const subject = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);
    const index = mostCommon.indexOf(subject);
    var part = Array4[index].split(" ")
    if(part[0] === "NN" || part[0] === "NNS" || part[0] === "NNP"){
      console.log("" + subject)
      return subject;
    }
  } 

/**************************************************************/
  //assumption genorator
  if(exclamtion.flat() || dependencies){
    if(exclamtion.flat().includes('hello') || exclamtion.flat().includes('Hello')){
      if(subject !== "patrick" && subject !== "Patrick"){
        assumptionCreate = true;
      }else{
        user = "Patrick";
        assumptionCreate = false;
      }
    }else if(dependencies.includes("poss")){
      if(subject !== "patrick" && subject !== "Patrick"){
        assumptionCreate = true;
      }else{
        user = "Patrick";
        assumptionCreate = false;
      }
    }else if(dependencies.includes("dobj") && resultArray.length === 1){
      if(subject !== "patrick" && subject !== "Patrick"){
        assumptionCreate = true;
      }else{
        user = "Patrick";
        assumptionCreate = false;
      }
    }else if(dependencies.includes("root") && resultArray.length === 1){
      if(user !== "patrick" && user !== "Patrick"){
        assumptionCreate = true;
      }else{
        assumptionCreate = false;
      }
    }
  }
  /**************************************************************/
  //next topic genorator
  if(dependencies){
    const actionsLower = pastActions.flat().map(w => w.toLowerCase());
    const nounsLower = nouns.flat().map(w => w.toLowerCase());
    const adjectivesLower = adjectives.flat().map(w => w.toLowerCase());
    if(actionsLower.includes('talk') && nounsLower.includes('something') && adjectivesLower.includes('else')){
      newTopicCreate = true;
    }else{
      newTopicCreate = false;
    }

  }
  /**************************************************************/
  //talking about self
  //...
  /**************************************************************/
  console.log(resultArray);
  var objArray;
  
  let opperand;
  let sentType;
  //get all sentClasses
  let sentArr = []
  resultArray.forEach(item => {
    if(item?.sentClass) sentArr.push(item.sentClass);
  });
  
  // find most frequent sentClass
  const freq = {};
  resultArray.forEach(item => {
    if(item?.sentClass) freq[item.sentClass] = (freq[item.sentClass] || 0) + 1;
  });
  const mostCommon = Object.keys(freq).reduce((a, b) => freq[a] > freq[b] ? a : b);

  // get the object with that sentClass
  objArray = resultArray.find(item => item?.sentClass === mostCommon);
  opperand = objArray.words;
  sentType = objArray.sentClass;

  //check if opperand is the same as last time if so retry with second most common sentClass  
  if(resultArray.length > 0){

    if(storedOpperand && opperand[0] === storedOpperand[0]){
      retry = true;
    }else{
      retry = false;
    }
    storedOpperand = opperand;
  }
  
  
  

  console.log(sentType);
  function compileSentence(resultArray, subject) {// test sentence
    var validOptions = resultArray
    .filter(group => group !== undefined && group.importance >= 3)
    .sort((a, b) => b.importance - a.importance);
      var testReply = "";
    for(let i = 0; i < validOptions.length; i++){
      testReply += validOptions[i].words + " ";
    }
    if(subject) {
      testReply += subject;
    }
    return testReply;
  }

/**************************************************************/
  //create objects for missing
  var testReply = compileSentence(resultArray, subject); 


  function findMissingNumbers(arr) {
    if (arr.length === 0) {
      return []; // No missing numbers in an empty array
    }
  
    // Sort the array to ensure proper sequence
    const sortedArr = [...arr].sort((a, b) => a - b);
    const missingNumbers = [];
  
    // Iterate from the first element to the last
    for (let i = 0; i < sortedArr.length - 1; i++) {
      const currentNum = sortedArr[i];
      const nextNum = sortedArr[i + 1];
  
      // If the difference is greater than 1, there are missing numbers
      if (nextNum - currentNum > 1) {
        for (let j = currentNum + 1; j < nextNum; j++) {
          missingNumbers.push(j);
        }
      }
    }
  
    return missingNumbers;
  }

  const missing = findMissingNumbers(usedWordsIndex);
  console.log("missing index: " + usedWordsIndex);

  for(let b = 0; b < missing.length; b++){
    const val = sentInput[missing[b]].split(" ");
    const mood = sentiments[missing[b]].split(" ");
    const POS = Array4[missing[b]].split(" ");
    var typeGroups = new typeGroup(1, val, dependencies[missing[b]], mood, POS);
    resultArray.splice(missing[b], 0, typeGroups);
    console.log(`MISSING: ${val}`);
    usedWordsIndex.push(missing[b]);
  }
/**************************************************************/
//create connection
//find out if person
  if(subject && sentType === "discourse-prep-nouns"){
    sentType = "discourse-prep-prop"
  }
/**************************************************************/
  //determine sentence by trial and error 
  var mod = sentInput.map(elm => elm.split(" "));
  reply = mod.map(elm => elm[elm.length-1]).join(" ")
  console.log(reply);
  if(!reply){
    reply = getResponce;
  }   
  console.log(reply);
  return [reply, sentArr];
}





module.exports = { createResponce, adjacentWord, trainModel }

