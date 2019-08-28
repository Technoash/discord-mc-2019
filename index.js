const Discord = require('discord.js')
const client = new Discord.Client()
const Query = require("minecraft-query");
const q = new Query({host: '127.0.0.1', port: 25565, timeout: 3000});
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const AWS = require('aws-sdk');
const backupsFolederPath = '../backups_mc';
const path = require('path');
const config = require('config');

AWS.config.update({ accessKeyId: config.get('aws.accessKeyId'), secretAccessKey: config.get('aws.secretAccessKey') });
const s3 = new AWS.S3();

const CronJob = require('cron').CronJob;

Array.prototype.diff = function(a) {
    return this.filter((i) => a.indexOf(i) < 0);
};


new CronJob('*/10 * * * * *', () => {
    q.fullStat()
        .then(success => handleQuery(success))
}, null, true, 'Australia/Sydney');


//every 6 hours
new CronJob('0 0 */6 * * *', () => {
    try{
        backupCron();
    } catch(e){
        console.error(`Could not back up`, e)
    }
}, null, true, 'Australia/Sydney');

backupCron();

async function backup() {
    const { stdout, stderr } = await exec('../mc/minecraft backup');
    if(stderr) throw new Error('Got error while backing up ' + stderr);
    const files = fs.readdirSync(backupsFolederPath);
    if(files.length != 1) throw new Error('No, or too many backup files made');
    return files[0];
}

function uploadFileS3(filename){
    return new Promise((res, rej)=>{
        fs.readFile(backupsFolederPath+'/'+filename, function (err, data) {
            if (err) rej(err); 
            var base64data = new Buffer(data, 'binary');
            s3.putObject({
                Bucket: 'minecraft-backups-aug-2019-server',
                Key: filename,
                Body: base64data,
                ACL: 'public-read'
            }, function (resp) {
                console.log(resp)
                res(`https://minecraft-backups-aug-2019-server.s3.amazonaws.com/${filename}`);
            });
        });
    })
}


async function backupCron(){
    await deleteFolderContents(backupsFolederPath);
    const filename = await backup();
    const url = await uploadFileS3(filename);
    sendMessage(`Backup created: download here: ${url}`);
}

function deleteFolderContents(directory){
    return new Promise((res,rej)=>{
        fs.readdir(directory, (err, files) => {
            if (err) res(err);
                for (const file of files) {
                    fs.unlink(path.join(directory, file), err => {
                        if (err) res(err);
                    });
                }
                res();
        });
    })
}

let serverName = "SERVER NAME";

let lastPlayers = [];
let botChannel;
client.login(config.get('discord.bot_secret'))

client.on('ready', () => {
    console.log("Connected as " + client.user.tag)
    botChannel = client.channels.get(config.get('discord.channel'))
})

function handleQuery(res){
    serverName = res.motd;
    const currentPlayers = res.players;
    const newPlayers = currentPlayers.diff(lastPlayers);
    const leftPlayers = lastPlayers.diff(currentPlayers);

    if(newPlayers.length) sendMessage(`:checkered_flag: Player${(newPlayers.length == 1)?'':'s'} ${newPlayers.map(a => '`'+a+'`').join(',')} joined *${serverName}*`);
    if(leftPlayers.length) sendMessage(`:x: Player${(leftPlayers.length == 1)?'':'s'} ${leftPlayers.map(a => '`'+a+'`').join(',')} left *${serverName}*`);

    lastPlayers = currentPlayers;
}

function sendMessage(msg){
    if(botChannel) botChannel.send(msg);
    console.log('Sending message: ', msg)
}

// client.guilds.forEach((guild) => {
//     console.log(" - ", guild.name, guild.id)

//     // List all channels
//     guild.channels.forEach((channel) => {
//         console.log(` -- ${channel.name} (${channel.type}) - ${channel.id}`)
//     })
// })