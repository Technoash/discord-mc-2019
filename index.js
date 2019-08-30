const Discord = require('discord.js')
const Query = require("minecraft-query");
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const AWS = require('aws-sdk');
const path = require('path');
const config = require('config');

AWS.config.update({ accessKeyId: config.get('aws.accessKeyId'), secretAccessKey: config.get('aws.secretAccessKey') });

const s3 = new AWS.S3();
const q = new Query({host: '127.0.0.1', port: 25565, timeout: 3000});
const client = new Discord.Client()

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
    if(backupInProgress) return sendMessage(':card_box: Backup already in progress');
    sendMessage(':card_box: Starting backup');
    backupInProgress = true;
    try {
        await deleteFolderContents(backupsFolederPath);
        const filename = await backup();
        const url = await uploadFileS3(filename);
        sendMessage(`:card_box: Backup of *${serverName}* created. download here: ${url}`);
    } finally {
        backupInProgress = false;
    }
}

function deleteFolderContents(directory){
    if(!directory || path.resolve(directory).substring(0, 13) != "/home/ubuntu/") throw Error('Wrong directory! ' + directory); 
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

function listPlayers(){
    let message = `:family_wwbb: \`${lastPlayers.length}\` player${(lastPlayers.length == 1)?'':'s'} on *${serverName}*${lastPlayers.length?':':''}  ${lastPlayers.map(a => '`'+a+'`').join(',')}`;
    sendMessage(message);
}

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


let backupInProgress = false;
let serverName = "SERVER NAME";
const backupsFolederPath = '../backups_mc';
let lastPlayers = [];
let botChannel;


client.login(config.get('discord.bot_secret'))

client.on('ready', () => {
    console.log(`Connected as: ${client.user.tag}`)


    //botChannel = client.channels.get(config.get('discord.channel'))
    botChannel = client.channels.get(config.get('discord.test_channel'))

    console.log(`To channel: ${botChannel.name}`)


    // handle commands
    botChannel.client.on('message', (msg)=>{
        if(msg.author.bot || msg.content[0] != '/') return;
        const parts = msg.content.replace(/\s\s+/g, ' ').split(' ');
        switch(parts[0]) {
            case '/help':
                sendMessage(':scroll: **Commands:** \n`/help`: list commands, \n`/players`: list players, \n`/backup`: generate a backup, \n`/map`: generate a map, \n`/logs <n>`: print *n* lines of the server log');
                break;
            case '/players':
                listPlayers();
                break;
            case '/backup':
                backupCron();
                break;
            case '/logs':
                printLogs(parts);
                break;
            default:
        }
    })

    // client.guilds.forEach((guild) => {
    //     console.log(" - ", guild.name, guild.id)

    //     // List all channels
    //     guild.channels.forEach((channel) => {
    //         console.log(` -- ${channel.name} (${channel.type}) - ${channel.id}`)
    //     })
    // })
})



//backupCron();