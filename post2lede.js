#!/usr/bin/env node

const { argv } = require('yargs')
  .usage('用法: ./$0 <folder-id> [options]')
  .alias('n', 'name')
  .describe('n', 'name 为推送到LEDE的下载地址')
  .help('h')
  .alias('h', 'help')
const https = require('http')
const querystring = require("querystring");

function httprequest(addUri){
  const data = JSON.stringify({
    "jsonrpc":"2.0",
    "method":"aria2.addUri",
    "id":"oraclelinux-Y3VybA==",
    "params":["token:5dfuwd0xxoa8d6bbh8r75141f5o4y5zg",
              [addUri],
              {"http-user":"","http-passwd":"lou8i7u9kLML"}
            ]
    })
  const options = {
      //   hostname: 'pi.dissipator.eu.org',
        hostname: 'pi.lucas.ga',
        port: 26800,
        path: '/jsonrpc',
        method: 'POST',
        headers: {
          "Accept": "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
          'Content-Length': data.length
        }
      }
  const req = https.request(options, res => {
    console.log(`状态码: ${res.statusCode}`)

    res.on('data', d => {
      process.stdout.write(d)
    })
  })

  req.on('error', error => {
    console.error(error)
  })

  req.write(data)
  req.end()
}

const [file] = argv._
// console.log(file)

if (file) {
  let result  = require('querystring').escape(file);
  let url = `https://v2.luoml.eu.org/${result}`;
  console.warn(url)
  httprequest(url)
} else {
  url = "http://nodejs.cn/"
  console.warn(url)
}

