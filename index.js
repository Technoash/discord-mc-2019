const Discord = require('discord.js')
const Query = require("minecraft-query");
const fs = require('fs');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const AWS = require('aws-sdk');
const path = require('path');
const config = require('config');
const mime = require('mime');

AWS.config.update({ accessKeyId: config.get('aws.accessKeyId'), secretAccessKey: config.get('aws.secretAccessKey') });

const s3 = new AWS.S3();
const q = new Query({host: '127.0.0.1', port: 25565, timeout: 3000});
const client = new Discord.Client()

const CronJob = require('cron').CronJob;

Array.prototype.diff = function(a) {
    return this.filter((i) => a.indexOf(i) < 0);
};

//every 10 seconds
new CronJob('*/10 * * * * *', () => {
    q.fullStat()
        .then(success => handleQuery(success))
}, null, true, 'Australia/Sydney');


//every day at 4am
new CronJob('0 0 4 * * *', () => {
    try{
        backupCron();
    } catch(e){
        console.error(`Could not back up`, e)
    }
}, null, true, 'Australia/Sydney');

async function mcIsRunning(){
    const { stdout, stderr } = await exec('/home/ubuntu/mc/minecraft status');
    if(stderr) throw new Error('Got error while checking server status: ' + stderr);
    if(stdout.substr(stdout.length - 16) == 'is not running.\n') return false;
    if(stdout.substr(stdout.length - 12) == 'is running.\n') return true;
    throw new Error('Not running or not running')
}

async function mcStop(){
    const { stdout, stderr } = await exec('/home/ubuntu/mc/minecraft stop');
    if(stderr) throw new Error('Got error while stopping: ' + stderr);
    if(stdout.substr(stdout.length - 12) == 'is stopped.\n') return true;
    console.log('stdout', stdout, 'stderr', stderr);
    throw new Error('Did not stop')
}

async function mcStart(){
    const { stdout, stderr } = await exec('/home/ubuntu/mc/minecraft start');
    if(stderr) throw new Error('Got error while starting: ' + stderr);
    if(stdout.substr(stdout.length - 16) == 'is now running.\n') return true;
    console.log('stdout', stdout, 'stderr', stderr);
    throw new Error('Did not start')
}

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
    }
    catch(e) {
        sendMessage(':card_box::interrobang: unable to back up: ' + e.message)
        throw e;
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

async function printLogs(parts){

    // head -n $(wc -l test | awk '{print $1-2}') test | tail -n5
    try {
        let n = 10;
        try {
            if(parts.length > 1) n = parseInt(parts[1]);
            if(isNaN(n)) throw new Error('*n* should be a number');
            if(n < 1) throw new Error('*n* should be greater than 0');
        } catch(e){
            throw new Error(`Invalid input: ${e.message}`);
        }

        let offset = 0;
        try {
            if(parts.length > 2) offset = parseInt(parts[2]);
            if(isNaN(offset)) throw new Error('*offset* should be a number');
            if(offset < 0) throw new Error('*offset* should be positive');
        } catch(e){
            throw new Error(`Invalid input: ${e.message}`);
        }

        let logFile = path.resolve('../mc/logs/latest.log');
        const { stdout, stderr } = await exec(`head -n $(wc -l ${logFile} | awk '{print $1-${offset}}') ${logFile} | tail -n${n}`);

        if(stdout.length + 8 > 2000) throw new Error('Logs too long. Try printing fewer lines');
        sendMessage('```\n'+stdout+'\n```');
    }
    catch(e) {
        console.log(e);
        sendMessage(`Could not print log: ${e.message}`);
    }
}


async function syncMapSite(){
    const { stdout, stderr } = await exec("s3-deploy '/home/ubuntu/worldrender/**' --cwd '/home/ubuntu/worldrender/' --region ap-southeast-2 --bucket minecraft-map-aug-2019-server");
    const lines = stdout.split('\n');
    if(lines.length < 2 || lines[lines.length-2] != 'Upload finished') throw new Error(`Got error while syncing map site stderr: ${stderr}`);
}

async function genMapSite(){
    if(mapGenerateInProgress) return sendMessage(":map: Already generating map!");
    try{
        sendMessage(":map: Stopping server to generate map");
        await mcStop();
        sendMessage(":map: Server stopped");
        mapGenerateInProgress = true;
        sendMessage(":map: Generating map")
        const { stdout, stderr } = await exec("/home/ubuntu/Minecraft-Overviewer/overviewer.py --rendermodes smooth_lighting /home/ubuntu/mc/5d6103ed90aec /home/ubuntu/worldrender");
        if(stderr) throw new Error('Got error while generating map site ' + stderr);
        sendMessage(":map: Nearly done...")
        await syncMapSite();
        sendMessage(":map: Map generated. View at: http://minecraft-map-aug-2019-server.s3-website-ap-southeast-2.amazonaws.com")
    }
    finally{
        sendMessage(":map: Starting server");
        await mcStart();
        mapGenerateInProgress = false;
        sendMessage(":map: Server started");
    }
}

let backupInProgress = false;
let mapGenerateInProgress = false;
let serverName = "SERVER NAME";
const backupsFolederPath = '../backups_mc';
let lastPlayers = [];
let botChannel;

client.login(config.get('discord.bot_secret'))

client.on('ready', () => {
    console.log(`Connected as: ${client.user.tag}`)


    botChannel = client.channels.get(config.get('discord.channel'))
    //botChannel = client.channels.get(config.get('discord.test_channel'))

    console.log(`To channel: ${botChannel.name}`)


    // handle commands
    botChannel.client.on('message', (msg)=>{
        if(msg.author.bot || msg.content[0] != '/') return;
        const parts = msg.content.replace(/\s\s+/g, ' ').split(' ');
        const parsedArgs = parts.slice(1);

        switch(parts[0]) {
            case '/help':
                sendMessage(':scroll: **Commands:** \n`/help`: list commands, \n`/players`: list players, \n`/backup`: generate a backup, \n`/map`: generate/update the map site, \n`/logs <n> <offset>`: print *n* lines of the server log');
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
            case '/map':
                genMapSite(parts);
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

