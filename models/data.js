const { FindOperators } = require('mongodb');
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const dataSchema = new Schema({
    Responce: {
        type: Array
    },
    Query: {
         type: String
    },
    Pos: {
        type: String
    },
    Label: {
        type: String
    }
}, {timestamps: true});



const dataModel = mongoose.model("dataModel", dataSchema);
module.exports =  dataModel;