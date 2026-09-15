const dns=require('node:dns');const net=require('node:net');const http=require('node:http');const https=require('node:https');
function publicAddress(address){if(net.isIP(address)!==4)return false;const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
function lookup(host,options,callback){dns.lookup(host,{family:4,all:true},(err,rows)=>{if(err)return callback(err);if(!rows.length||rows.some(r=>!publicAddress(r.address)))return callback(new Error('Adresse réseau privée interdite.'));callback(null,options.all?rows:rows[0].address,4);});}
const agents={ 'http:':new http.Agent({lookup}), 'https:':new https.Agent({lookup})};
module.exports=function agent(url){if(url.username||url.password||!agents[url.protocol])throw new Error('URL interdite.');const host=url.hostname.replace(/^\[|\]$/g,'');if(net.isIP(host)&&!publicAddress(host))throw new Error('Adresse réseau privée interdite.');return agents[url.protocol];};
module.exports.publicAddress=publicAddress;
