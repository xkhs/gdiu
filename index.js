const TeleBot = require('telebot');
const axios = require('@viegg/axios')

const { https_proxy, http_proxy, all_proxy } = process.env
const proxy_url = https_proxy || http_proxy || all_proxy
let axins
if (proxy_url) {
  console.log('使用代理：', proxy_url)
  let ProxyAgent
  try {
    ProxyAgent = require('proxy-agent')
  } catch (e) { // 没执行 npm i proxy-agent
    ProxyAgent = require('https-proxy-agent')
  }
  axins = axios.create({ httpsAgent: new ProxyAgent(proxy_url) })
} else {
  axins = axios.create({})
}

const { spawn } = require('child_process');

const { db } = require('./db');
const { validate_fid, gen_count_body, count, get_info_by_id, get_name_by_id, walk_and_save_live, get_sa_token, trash_file } = require('./src/gd');
const { send_count, send_help, send_choice, send_task_info, sm, extract_fid, extract_from_text, reply_cb_query, tg_copy, send_all_tasks, send_bm_help, get_target_by_alias, gen_bookmark_choices, send_all_bookmarks, set_bookmark, unset_bookmark, clear_tasks, send_task_help, rm_task, clear_button } = require('./src/tg')
const { format_size } = require('./src/summary')

const { AUTH, ROUTER_PASSKEY, TG_IPLIST, DEFAULT_TARGET } = require('./config')
//const { tg_whitelist } = AUTH
const { tg_token } = AUTH
const { adminUsers } = AUTH

const fs = require('fs')
const crypto = require('crypto')
const ID_DIR_MAPPING = {}
const FOLDER_TYPE = 'application/vnd.google-apps.folder'

const BUTTONS = {
  export: {
    label: '🌍 export',
    command: '/export'
  },
  youtube: {
      label: '👋 youtube',
      command: '/yd'
  },
  aria2: {
      label: '🌍 aria2',
      command: '/aria2'
  },
//   restart: {
//     label: '👋 restart',
//     command: '/restart'
//   },
  runshell: {
    label: '👋 runshell',
    command: '/runshell'
  },
  update: {
      label: '🌍 update',
      command: '/update'
  },
  hello: {
      label: '👋 Hello',
      command: '/hello'
  },
  world: {
      label: '🌍 World',
      command: '/world'
  },
  hide: {
      label: '⌨️ Hide keyboard',
      command: '/hide'
  }
};
const bot = new TeleBot({
  token: tg_token,
  usePlugins: ['reporter'],
  pluginConfig: {
      reporter: {
          events: ['reconnect', 'reconnected', 'stop', 'error'],
          to: adminUsers
      }
  },
  usePlugins: ['namedButtons'],
  pluginConfig: {
      namedButtons: {
          buttons: BUTTONS
      }
  },
});

const COPYING_FIDS = {}
const counting = {}
let MSG = '';

function exec (cmd, msg) {
  const id = msg.from.id;
  if(adminUsers.indexOf(id) < 0){
      msg.reply.text('您的用户名或ID不在机器人的白名单中，如果是您配置的机器人，请先到config.js中配置自己的username');
      return console.warn('收到非白名单用户的请求')
  }

  let words = String(cmd).split(" ");
  let len = words.length;
  let args = [];
  if (len > 1 ){
      args = words.slice(1, len);
  }
    console.log( len,args )
    console.log( words[0] )
    // msg.reply.text('$: '+words[0] + " " +  args);
    const shell = spawn(words[0],args).on('error', function( err ){
        msg.reply.text(err);
    });

    if(shell){
       shell.stdout.on('data', (data) => {
        msg.reply.text(`${data}`);
       });
        shell.stderr.on('data', (data) => {
        msg.reply.text(`stderr: ${data}`);
       });
    }
}

bot.sendMessage(adminUsers[0],"you gdutils_bot ins online!") //填写你的chat id ,机器人上线时你第一时间里会收到通知
let sql = `update acting set "doing"=0 where act='restart';`;
db.exec(sql);

bot.on('/yd', (msg) =>{
  if(MSG.startsWith('http')){
    let ydurl = 'yd ' + MSG;
    console.log( ydurl )
    msg.reply.text('run yd ');
    exec(ydurl, msg);
    return bot.sendMessage(msg.from.id, '已执行！', {replyMarkup: 'hide'});
  }
  return bot.sendMessage(msg.from.id, '无地址 ！', {replyMarkup: 'hide'});
});

// bot.on('/aria2', (msg) => exec('aria2 ' + MSG, msg));
bot.on('/aria2', (msg) => {
  exec('aria2 ' + MSG, msg)
  post_2_aria2("name",MSG)
    .then(res  => {
      // console.warn(res)
      const msgs = `download_uri:\n${download_uri}`
      return sm({chat_id,text: `${msgs}\n 成功推送下载:${res.result}`})
    })
    .catch(error=>{
      console.warn(error)
      return sm({chat_id,text: `${error}`})
    })
});

bot.on('/hide', (msg) => msg.reply.text('Type /start to show keyboard again.', {replyMarkup: 'hide'}));
bot.on('/restart', (msg) => {
  acting_tasks=db.prepare('select doing from acting where act=?').all('restart')[0];
  console.warn(acting_tasks.doing);
  if(acting_tasks.doing == 1){
    let sql = `update acting set "doing"=0 where act='restart';`;
    db.exec(sql);
    exec('pm2 restart all', msg);
    msg.reply.text('restarting!')
  }
});

bot.on('/update', msg => {
  exec('git pull -f', msg);
  msg.reply.text('代码已更新，请在后台执行pm2 restart all！')
});

bot.on('/runshell', msg => {
  if(MSG == "")return bot.sendMessage(msg.from.id, '无命令', {replyMarkup: 'hide'});
    msg.reply.text('run shell:' + MSG);
    exec(MSG, msg);
    return bot.sendMessage(msg.from.id, '已执行！', {replyMarkup: 'hide'});
});

bot.on('/start', (msg) => {
  let replyMarkup = bot.keyboard([
      [BUTTONS.update.label],
      [BUTTONS.hide.label]
  ], {resize: true});
  return bot.sendMessage(msg.from.id, 'ChatId is ' + msg.chat.id + ',See keyboard below.', {replyMarkup});
});

bot.on('/error', (msg) => msg.MAKE_AN_ERROR);
bot.on('/stop', () => bot.stop('bye!'));

async function gen_input_file ({ fid, service_account, update, output, hashkey, cf, expire, target='' }) {
  const root = await get_name_by_id(fid, service_account)
  const info = await get_info_by_id(fid, service_account)
  const data = await walk_and_save_live({ fid, service_account, update })
  const files = data.filter(v => v.mimeType !== FOLDER_TYPE)
  const folders = data.filter(v => v.mimeType === FOLDER_TYPE)
  const files_choices = []
  // console.warn(fid,)
  folders.map(folder => {
    const { id, name, parent, size } = folder
    if(parent == fid){
      // const n=name.substring(0, 10).replace(" ","").replace(/\./g,"").replace(":","")
      // const line1 = [{ text: `📂 ${name}`, callback_data: `export ${id} 0 0` }]
      // const line2 = [{ text: `📂 统计`, callback_data: `count ${id}` },{ text: `📂 收藏:${name}`, callback_data: `bm ${id}`}]
      const line = [{ text: `📂 ${name}`, callback_data: `export ${id} 0 0` },{ text: `📂 统计`, callback_data: `count ${id}` }]
      files_choices.push(line)
      // files_choices.push(line2)
    }
  });
  files.map(file => {
    const { id, name, mimeType, parent, size } = file
    if(parent == fid){
    // console.warn(file)
    const icon = (mimeType.startsWith('video') || mimeType.startsWith('application')) ? `📺${name}` : `📄${name}`
    const line = [
      { text: icon, callback_data: `count ${id}` },{ text: `info`, callback_data: `info ${id}` }
      // { text: `aria2`, callback_data: `aria2 ${id}` }
    ]
    files_choices.push(line)
    }
  });
  return { files_choices, info }
}

function gen_direct_link ({ file, hashkey, cf, expire }) {
  const { name, id } = file
  console.warn(name, id);
  const expired = Date.now() + (Number(expire) || 24) * 3600 * 1000
  const str = `expired=${expired}&id=${id}`
  const sig = hmac(str, hashkey)
  if (!cf.startsWith('http')) cf = 'https://' + cf
  return `${cf}/api/download/${name}?${str}&sig=${sig}`
}

function hmac (str, hashkey) {
  return crypto.createHmac('sha256', hashkey).update(str).digest('hex')
}

function get_dir (id, folders) {
  let result = ID_DIR_MAPPING[id]
  if (result !== undefined) return result
  result = ''
  let temp = id
  let folder = folders.filter(v => v.id === temp)[0]
  while (folder) {
    result = `/${folder.name}` + result
    temp = folder.parent
    if (ID_DIR_MAPPING[temp]) {
      result = ID_DIR_MAPPING[temp] + result
      return ID_DIR_MAPPING[id] = result
    }
    folder = folders.filter(v => v.id === temp)[0]
  }
  return ID_DIR_MAPPING[id] = result
}

async function post_2_aria2 (name, url) {
  const ariaurl="http://pi.lucas.ga:26800/jsonrpc"
  let params = {
    "jsonrpc":"2.0",
    "method":"aria2.addUri",
    "id":"gdbot-Y3VybA==",
    "params":["token:5dfuwd0xxoa8d6bbh8r75141f5o4y5zg",
              [url],
              {"http-user":"","http-passwd":"lou8i7u9kLML"}
            ]
    }
  const config = {}
  config.headers = { "Accept": "application/json, text/plain, */*","Content-Type": "application/json;charset=UTF-8" }
  const { data } = await axins.post(ariaurl, params, config)
  console.warn(data)
  return data
}

bot.on('/export', (msg) => {
  let chat_id = msg.from.id;
  let words = String(msg.text).split(" ")
  console.warn(msg,words)
  let fid = (words[1]) ? words[1] : '0AO4LaCU7vdQ_Uk9PVA';
  let update=false,service_account=true,hashkey=false,cf=false,expire=24;
  let output = 'uri.txt'
  const choices = [{ text: '文件统计', callback_data: `count ${fid}` },{ text: '开始复制', callback_data: `copy ${fid}` }]
  const bm = [{ text: `🌸 将此文件夹添加到收藏夹`, callback_data: `bm ${fid}`}]
  gen_input_file({ fid, update, service_account, output, hashkey, cf, expire })
  .then(res  => {
    // console.warn(res.files_choices)
    return sm({
      chat_id,
      text: `识别出分享ID ${fid}，请选择动作`,
      reply_markup: {
        inline_keyboard: [bm].concat(res.files_choices)
      }
    })
  })
  .catch(console.error)

});

bot.on('text', (msg) => {
    MSG = msg.text;
    const chat_id = msg && msg.chat && msg.chat.id
    // console.log(MSG);

    // console.log('chat_id:   '+ chat_id);
    // let prex = String(msg.text).substring(0,1);
    // console.log(prex);

    const text = msg && msg.text && msg.text.trim() || ''
    const message_str = text
    // let username = msg && msg.from && msg.from.username
    // msgs = username && String(username).toLowerCase()
    // let user_id = msgs && msgs.from && msgs.from.id
    // user_id = user_id && String(user_id).toLowerCase()
    const id = msg.from.id;
    if(adminUsers.indexOf(id) < 0){
        msg.reply.text('您的用户名或ID不在机器人的白名单中，如果是您配置的机器人，请先到config.js中配置自己的username');
        return console.warn('收到非白名单用户的请求')
    }
      const fid = extract_fid(text) || extract_from_text(text) || extract_from_text(message_str)
      const no_fid_commands = ['/task', '/help', '/bm']
      if (!no_fid_commands.some(cmd => text.startsWith(cmd)) && !validate_fid(fid)) {
        console.log(message_str);
        if (text.startsWith('/')||text.startsWith('👋')||text.startsWith('🌍')||text.startsWith('⌨️')||text.startsWith(' ')) return;
        sm({ chat_id, text: '未识别出分享ID' })
        if(message_str.startsWith('http')||MSG.startsWith('magnet')){
          is_shell = true
          let replyMarkup = bot.keyboard([
            [BUTTONS.youtube.label, BUTTONS.aria2.label],
            [BUTTONS.hide.label]
          ], {resize: true});
          return bot.sendMessage(msg.from.id, '你可能要执行：', {replyMarkup});
          }
        let replyMarkup = bot.keyboard([
          [BUTTONS.update.label, BUTTONS.runshell.label],
          [BUTTONS.hide.label]
        ], {resize: true});
        return bot.sendMessage(msg.from.id, '你可能要执行：', {replyMarkup});
      }
      if (text.startsWith('/help')) return send_help(chat_id)
      if (text.startsWith('/bm')) {
        const [cmd, action, alias, target] = text.split(' ').map(v => v.trim()).filter(v => v)
        if (!action) return send_all_bookmarks(chat_id)
        if (action === 'set') {
          if (!alias || !target) return sm({ chat_id, text: '别名和目标ID不能为空' })
          if (alias.length > 24) return sm({ chat_id, text: '别名不要超过24个英文字符长度' })
          if (!validate_fid(target)) return sm({ chat_id, text: '目标ID格式有误' })
          set_bookmark({ chat_id, alias, target })
        } else if (action === 'unset') {
          if (!alias) return sm({ chat_id, text: '别名不能为空' })
          unset_bookmark({ chat_id, alias })
        } else {
          send_bm_help(chat_id)
        }
      } else if (text.startsWith('/count')) {
        if (counting[fid]) return sm({ chat_id, text: fid + ' 正在统计，请稍等片刻' })
        try {
          counting[fid] = true
          const update = text.endsWith(' -u')
          send_count({ fid, chat_id, update })
        } catch (err) {
          console.error(err)
          sm({ chat_id, text: fid + ' 统计失败：' + err.message })
        } finally {
          delete counting[fid]
        }
      } else if (text.startsWith('/copy')) {
        let target = text.replace('/copy', '').replace(' -u', '').trim().split(' ').map(v => v.trim()).filter(v => v)[1]
        target = get_target_by_alias(target) || target
        if (target && !validate_fid(target)) return sm({ chat_id, text: `目标ID ${target} 格式不正确` })
        const update = text.endsWith(' -u')
        tg_copy({ fid, target, chat_id, update }).then(task_id => {
          task_id && sm({ chat_id, text: `开始复制，任务ID: ${task_id} 可输入 /task ${task_id} 查询进度` })
        })
      } else if (text.startsWith('/task')) {
        let task_id = text.replace('/task', '').trim()
        if (task_id === 'all') {
          return send_all_tasks(chat_id)
        } else if (task_id === 'clear') {
          return clear_tasks(chat_id)
        } else if (task_id === '-h') {
          return send_task_help(chat_id)
        } else if (task_id.startsWith('rm')) {
          task_id = task_id.replace('rm', '')
          task_id = parseInt(task_id)
          if (!task_id) return send_task_help(chat_id)
          return rm_task({ task_id, chat_id })
        }
        task_id = parseInt(task_id)
        if (!task_id) {
          const running_tasks = db.prepare('select id from task where status=?').all('copying')
          if (!running_tasks.length) return sm({ chat_id, text: '当前暂无运行中的任务' })
          return running_tasks.forEach(v => send_task_info({ chat_id, task_id: v.id }).catch(console.error))
        }
        send_task_info({ task_id, chat_id }).catch(console.error)
      } else if (message_str.includes('drive.google.com/') || validate_fid(text)) {
        return send_choice({ fid: fid || text, chat_id })
      }
});

// Inline button callback
bot.on('callbackQuery', msg => {
    // User message alert
    const id = msg.from.id;
    if(adminUsers.indexOf(id) < 0){
        msg.reply.text('您的用户名或ID不在机器人的白名单中，如果是您配置的机器人，请先到config.js中配置自己的username')
        return console.warn('收到非白名单用户的请求')
    }
    if (msg) {
    const { id, message, data } = msg
    const chat_id = msg.from.id
    //let [action, fid] = String(data).split(' ')
    let [action, fid, target, a] = data.split(' ').filter(v => v)
    // console.log("action:"+action);console.log("fid:"+fid);console.log("target:"+target);
    if (action === 'count') {
      if (counting[fid]) return sm({ chat_id, text: fid + ' 正在统计，请稍等片刻' })
      counting[fid] = true
      send_count({ fid, chat_id }).catch(err => {
        console.error(err)
        sm({ chat_id, text: fid + ' 统计失败：' + err.message })
      }).finally(() => {
        delete counting[fid]
        send_choice({ fid: fid || text, chat_id })
      })
    } else if (action === 'export') {
      let update=false,service_account=true,hashkey=false,cf=false,expire=true;
      let output = 'uri.txt'
      let page = parseInt(target)
      if (a === '-1') page--
      if (a === '1') page++
      console.log("fid",fid)
      const choices = [{ text: '文件统计', callback_data: `count ${fid}` },{ text: '开始复制', callback_data: `copy ${fid}` }]
      const bm = [{ text: `🌸 将此文件夹添加到收藏夹`, callback_data: `bm ${fid}`},{ text: `删除此文件/文件夹`, callback_data: `del ${fid}`}]
      gen_input_file({ fid, update, service_account, output, hashkey, cf, expire })
      .then(res  => {
        // console.log('已生成', output)
        // console.log('执行命令即可下载：\n', cmd)
        console.log('文件数', res.info)
        let items = res.files_choices
        let pid = (res.info.parents) ? res.info.parents[0] : fid
        console.log(pid, fid)
        var size = 10
        if (items.length >= size){
          const start=page*size,end=start+size
          let res2 = items.slice(start,end)
          console.log(typeof size,typeof start,typeof end);
          console.log(size,start,end,page);
          // console.log(`${start}-${end}`);console.log(res2[0])
          const { message_id, text } = message || {}
          // if (message_id) clear_button({ message_id, text, chat_id })
          if (message_id) sm({ chat_id, message_id, text, parse_mode: 'HTML' }, 'editMessageText')
          per = { text: '上一页', callback_data: `export ${fid} ${page} -1` }
          next = { text: '下一页', callback_data: `export ${fid} ${page} 1` }
          console.log(page,end , items.length)
          return sm({
            chat_id,
            text: `识别出ID ${fid}，第${page}页；请选择动作`,
            reply_markup: {
              inline_keyboard: [bm,
                [(page > 0 ) ? per : { text: '返回', callback_data: `export ${pid} 0 0` },
                 (end < items.length) ? next : { text: '回到首页', callback_data: `export ${fid} 0 0` }]
              ].concat(res2)
            }
          })
        }
        return sm({
          chat_id,
          text: `识别出ID ${fid}，请选择动作`,
          reply_markup: {
            inline_keyboard: [bm,[{ text: '返回', callback_data: `export ${pid} 0 0` }]].concat(items)
          }
        })
      })
      .catch(console.error)

    } else if (action === 'del') {
      console.log("del id:"+fid);
      let update=false,service_account=true,hashkey=false,cf=false,expire=true
      trash_file({ fid, service_account })
      .then(res  => {
        console.log('删除文件', res)
        return sm({
          chat_id,
          text: `成功将 ${fid} 文件/文件夹放入回收站`
        })
      }).catch(console.error)
    } else if (action === 'bm') {
      console.log(`bm set ${fid}`);
      get_name_by_id(fid, service_account)
      .then(res  => {
          let alias=res
          target=fid
          if (!alias || !alias) return sm({ chat_id, text: '别名和目标ID不能为空' })
          if (alias.length > 24) return sm({ chat_id, text: '别名不要超过24个英文字符长度' })
          if (!validate_fid(target)) return sm({ chat_id, text: '目标ID格式有误' })
          set_bookmark({ chat_id, alias, target })
      })
      .catch(console.error)

    } else if (action === 'info') {
      console.log("info id:"+fid);
      let update=true,service_account=true,hashkey='f6987d59203d1ce6c96c8d66e556a586710f4a24',cf='https://gdbot.lml.workers.dev',expire=24;
      get_info_by_id(fid, true)
      .then(res  => {
        // console.log(res)
        const { id, name, mimeType, parent, size } = res
        const file = { id, name, parent, size } 
        const download_uri = (hashkey && cf) ? gen_direct_link({ file, hashkey, cf, expire }) : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
        const msgs = `# 文件大小：\n${format_size(size)}
          download_uri:\n${download_uri}
          out:\n${name}`
        // sm({chat_id,text: `文件${msgs}，请选择动作`})
        return sm({
          chat_id,text: `文件${msgs}，请选择动作`,
          reply_markup: {
            inline_keyboard: [[{ text: `aria2`, callback_data: `aria2 ${id}` }]]
          }
          
        })
      })
      .catch(console.error)
    } else if (action === 'aria2'){
      let update=true,service_account=true,hashkey='f6987d59203d1ce6c96c8d66e556a586710f4a24',cf='https://gdbot.lml.workers.dev',expire=24;
      get_info_by_id(fid, true)
      .then(res  => {
        // console.log(res)
        const { id, name, mimeType, parent, size } = res
        const file = { id, name, parent, size } 
        const download_uri = (hashkey && cf) ? gen_direct_link({ file, hashkey, cf, expire }) : `https://www.googleapis.com/drive/v3/files/${id}?alt=media`
        post_2_aria2(name,download_uri)
        .then(res  => {
          // console.warn(res)
          const msgs = `# 文件大小：\n${format_size(size)}
          download_uri:\n${download_uri}
          out:\n${name}`
          return sm({chat_id,text: `${msgs}\n 成功推送下载:${res.result}`})
        })
        .catch(error=>{
          console.warn(error)
          return sm({chat_id,text: `${error}`})
        })
      })
      // .catch(console.error)

    } else if (action === 'copy') {
      console.log("copy id:"+fid);
      if (COPYING_FIDS[fid]) return sm({ chat_id, text: `正在处理 ${fid} 的复制命令` })
      COPYING_FIDS[fid] = true
      tg_copy({ fid, target: get_target_by_alias(target), chat_id }).then(task_id => {
        task_id && sm({ chat_id, text: `开始复制，任务ID: ${task_id} 可输入 /task ${task_id} 查询进度` })
      }).finally(() => COPYING_FIDS[fid] = false)
    } else if (action === 'update') {
      if (counting[fid]) return sm({ chat_id, text: fid + ' 正在统计，请稍等片刻' })
      counting[fid] = true
      send_count({ fid, chat_id, update: true }).finally(() => {
        delete counting[fid]
      })
    } else if (action === 'clear_button') {
      const { message_id, text } = message || {}
      // if (message_id) clear_button({ message_id, text, chat_id })
      if (message_id) sm({ chat_id, message_id, text, parse_mode: 'HTML' }, 'editMessageText')
    }
    return reply_cb_query({ id, data }).catch(console.error)
  }
    return bot.answerCallbackQuery(msg.id, `Inline button callback: ${ msg.data }`, true);
});

bot.on(/^!.*/, (msg, props) => {
  // let prex = String(msg.text).substring(0,1);
  // console.log(prex);
  const id = msg.from.id;
  if(adminUsers.indexOf(id) < 0){
      msg.reply.text('您的用户名或ID不在机器人的白名单中，如果是您配置的机器人，请先到config.js中配置自己的username');
      return console.warn('收到非白名单用户的请求')
  }

  let words = String(msg.text).split(" ");
  let len = words.length;
  let args = [];
  if (len > 2 ){
      args = words.slice(2, len);
  }
    console.log('run shell2    ')
    msg.reply.text('$: '+words[1] + "  " + args);
    const shell = spawn(words[1],args).on('error', function( err ){
        msg.reply.text('error while executing:'+words[1]);
        msg.reply.text(err);
    });
    if(shell){

       shell.stdout.on('data', (data) => {
        msg.reply.text(`stdout:\n ${data}`);
       });

       shell.stderr.on('data', (data) => {
        msg.reply.text(`stderr: ${data}`);
       });

       shell.on('close', (code) => {
        msg.reply.text(`shell exited with code ${code}`);
       });
}

});
bot.on('/error', (msg) => msg.MAKE_AN_ERROR);
bot.on('/stop', () => bot.stop('bye!'));
bot.start();
