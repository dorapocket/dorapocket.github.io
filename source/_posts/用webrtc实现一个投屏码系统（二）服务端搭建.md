---
title: 用WebRTC实现一个投屏码系统（二）服务端搭建
tags:
  - WebRTC
  - 前端
id: '110'
categories:
  - - 前端
date: 2021-03-14 11:55:21
---

在阅读本文之前，建议先看以下之前的内容

我们已经在之前讲解了WebRTC的基本原理和被投放端和投放发起端的交互流程，本节来进行服务端的搭建。我将以node.js作为后端。

您可能需要预先了解以下知识：socket.io实现的websocket，nodejs服务器express框架，WebRTC的交互流程，TURN/STUN服务器。

服务端主要有两部分组成：信令服务器和TURN/STUN服务器，当然，他们可以跑在同一个主机上。

## 信令服务器

### 聊聊WebSocket和Socket.IO

简单来说：websocket是一个可以让服务器主动推送消息给客户端的技术。

在常见的项目中，往往都是前端发起请求，后端进行响应的模型。后端如果需要主动推送信息，常常会用到轮询。这种大规模的轮询大多是无意义的浪费性能的行为。websocket标准可以让客户端与服务端之间建立起长连接，连接成功后可以进行全双工的通信，即服务端可以主动推送信息给目标客户端。

为什么在WebRTC中我们需要WebSocket？

_keyboard\_arrow\_down_

上篇讲到。双方为了进行RTC通信，需要先“知道对方是谁”，即交换由peerConnection产生的Offer和Answer。比如A要链接B，信令服务器这个“第三者”拿到了A的offer以后，应主动推送给B，拿到B的Answer以后，应主动推送给A。这就需要WebSocket技术。

Socket.IO是一个node.js库。用于在后端建立起WebSocket服务。你可以像这样在以Express为后端框架的服务器上这样加载他：

```
//  若你需要在同一端口监听socket和express请求，可以用这种写法
// 引入node包
const express = require('express');
const socketio = require('socket.io');
// 创建express和http后端
const app = express();
const http = require('http');
// 绑定express的http服务

const server = http.createServer(app);
// 把socket.io绑定到http服务器上
const io = socketio(server, { cors: true });
server.listen(80);

// 当然，若你不在意还要用express搭建其他的后端逻辑，只需要socket而已，上面的都不需要，可以用
const io = require('socket.io')(80);
//  直接搞定
```

以后，就可以使用io来进行WebSocket的事件处理了。常用的指令如：

```
io.of('NAMESPACE').on('connection', (socket) => {
    socket.on('YOUR_EVENT',(arg1,arg2,...)=>{
        // YOUR_CODE_HERE
    });
    socket.join(ROOM_NAME);
    io.to('abc').emit('EVENT',args); 
  

      socket.broadcast.emit('EVENT',args); 

      socket.broadcast.to('ROOM').emit('EVENT',...args);
});
```

*   io.of('NAMESPACE'):指定了命名空间。允许你在同一个http服务运行很多个websocket。比如，如果NAMESPACE=‘/rtc’，那么你在尝试连接的时候应该访问 http://your.domain/rtc 来建立连接。
*   io.on('EVENT\_NAME'):事件绑定。 常见的保留事件有：connection（连接建立成功触发，携带一个本次链接的socket对象作为参数。可以保存起来。），disconnect（链接断开时触发，可以做一些内存清理）
*   socket.on('YOUR\_EVENT'):自定义事件绑定。和io.on不同。可以理解为io用来创建和记录socket链接，而socket.on则负责处理单个链接内部事件。事件名称可以自定义。当客户端链接socket成功后，客户端也会拿到一个socket对象。比如客户端调用socket.emit('foo',args1,args2,...)；服务端就可以通过socket.on('foo',(args1,args2)=>{ //your code });进行参数获取。同理，服务器也可以用emit触发客户端定义好的事件。emit在获取时间名'foo'后，跟随的的参数会依次传送给socket.on的回调函数。
*   socket.emit('EVENT\_NAME',args1,args2,...) 用于触发事件，见上。
*   socket.join(ROOM\_NAME);传入房间名，可以让socket加入ROOM，当一个ROOM有很多个socket的时候，可以很方便的对所有连接的socket进行广播。
*   io.to(ROOM\_NAME).emit('EVENTNAME',...args); 向**所有该房间**的socket发送事件，包括自己。
*   socket.broadcast.emit('EVENTNAME',...args);向和该socket处于**同一命名空间**的所有socket发送事件，不包括自己。
*   socket.broadcast.to(ROOM).emit('EVENTNAME',...args); 向**同一命名空间**指定的房间广播信息，不包括自己。

更多关于socket.io的信息，见[官方文档](https://socket.io/)。

为什么我建立socket时会请求socket.io?DIO=xxxx,返回404？

_keyboard\_arrow\_down_

请打开开发者控制台查看。client应该会产生一个类似于http://....../YOURNAMESPACE/socket.io?EIO=xxxx 的请求。请检查您的服务器设置是否正确，端口是否开放。这个文件不需要您手动放在服务器上，当client请求建立连接时，这个请求会被socket.io服务器捕获，来作为建立websocket链接的基础。

### 信令服务器搭建

下面的代码讲解我将会从三端代码（发起投屏端，信令服务器，被投屏端）入手，一步一步的实现信令服务，因为websocket更像是几个人在“对话”，请注意每段代码到底是属于三端的哪端的。

```
// 被投屏端，向信令服务器注册，等待连接。
import io from "socket.io-client"
let socket = io.connect('YOUR_SOCKET_SERVER');
socket.on('connect',function()=>{ // 保留事件，连接成功触发
    socket.emit('TV_INIT'); // 触发TV_INIT事件，可以在参数传token之类的校验。
})；
```

```
// 信令服务器端
// 外面的io.on就在这写一次，以后信令服务器的socket监听直接都扔io.on里面就行
io.on('connection',(socket)=>{
    socket.on('TV_INIT',function(){
        // 你的代码,生成投屏码projCode
        socket.join(projCode); // 加入房间
        socket.emit('TV_INIT_OK',projCode); // 返回投屏码
    })
});
```

```
// 被投屏端
socket.on('TV_INIT_OK',(code)=>{
    // 拿到投屏码code，显示出来。
})
```

接下来是WebRTC的服务流程

```
// 发起投屏端
// 拿到输入的投屏码,加入房间
socket.emit('JOIN_ROOM',projCode);// 也可以在这时候做用户的身份校验
```

```
// 信令服务器
socket.on('JOIN_ROOM',projcode=>{
    // 保存socket和它的projcode，可以用一个对象
    socket.join(projcode); // 加入房间
})
```

```
// 发起投屏端
// 生成PeerConnection的Offer，发送给信令服务器转发
socket.emit('CLIENT_OFFER_TO_SERVER',offer);
```

```
// 信令服务器
socket.on('CLIENT_OFFER_TO_SERVER',offer=>{
     // 向被投屏端转发offer，利用broadcast直接在房间里广播。ROOM是之前加入房间的时候保存的
     socket.broadcast.to(ROOM).emit('CLIENT_OFFER_TO_TV',offer);
});
```

```
// 被投屏端
socket.on('CLIENT_OFFER_TO_TV',offer=>{
    // 被投屏端拿到了offer，创建Answer，按照相同的方法返回。
})
```

交换offer的方法如上。但根据WebRTC规范，还需要实现ICE信息的交换（ICECandidateExchange），也可以采取类似的思路，不过注意emit ICE交换事件时的时机，建议放在onicecandidate事件中，从event回调中拿到ice候选者进行转送。

```
// 发起投屏端
peerConnection.onicecandidate = function (event) {
          console.log(event);
          if (event.candidate) {
            socket.emit("RTC_Candidate_Exchange", {
              iceCandidate: event.candidate,
            });
          }
        };
```

```
// 投屏端
socket.on("RTC_Candidate_Exchange", async (message) => {
      if (message.iceCandidate) {
        try {
          await peerConnection.addIceCandidate(message.iceCandidate);
        } catch (e) {
          console.error("Error adding received ice candidate", e);
        }
      }
    });
```

> _warning_ 必须实现ICE候选者交换  
> **必须实现ICE候选者交换，否则可能会出现P2P无法建立、无法投屏或只能内网投屏的问题。 若您在log中发现ICE候选人收集事件没有被触发，经检查你的Offer生成和交换过程。我遇到的原因是因为没有在createOffer之前加载stream（可能导致系统认为没有数据要传输？）检查这一点最简单的方法是console.log打印你的Offer，你的offer应该是特别长的一串（起码20行以上）**

实现完这些以后，若你的TURN/STUN服务器设置正确（在new RTCPeerConnection(config)时传入的config无误），投屏应该会马上开始！Congratulations！

## TURN/STUN服务器搭建

但是，我们还有别的事情要做：搭建自己的TURN/STUN服务器。

这部分非常复杂。好在著名的Google开源了一款方案：Coturn

关于Coturn的部署网上教程一大堆，大家可以看下面这篇

补充几点：

coturn数据库路径：/usr/local/var/db/turndb  
coturn配置文件路径：/usr/local/etc/turnserver.conf

我在这补充一点鉴权相关的，感觉相关资料挺少的。如何利用coturn服务器鉴权和配置tls访问？

打开coturn的配置文件，加入：

```
external-ip=公网ip
user=你的user
realm=你添加的realm
lt-cred-mech
cert=证书位置
pkey=证书位置
use-auth-secret
static-auth-secret=自己随便设
```

其中static-auth-secret代表你自己指定静态密钥，而不设会从coturn的数据库中turn-secret表中查找密钥。

那么，我们如何生成链接服务器所需的username和password呢？

官方的规则很简单，用户名是 “过期时间：用户名”的字符串拼接，其中用户名可以是任何值，不用事先注册，如果你要做系统，可以使用你原有系统的username。而密码则是用sha1加密后的base64格式的密码。如果你开启了use-static-secret，coturn会直接用用户名和你设定的密钥做加密然后和你的密码比对。也就是说如果密钥泄露，则密码相当于没有。如果你没有设置，coturn会用在turn-secret数据表中的secret逐个尝试比对，应该是为了提升安全性。

可以在你的用户鉴权后返回turn的登录信息。如果你用js可以这样写

```
// 安全提示：你应该在后端运行这些代码而不是在客户端！！！
const crypto=require('crypto');

function getKey(username) {

// 如果你在配置文件开启了use-static-secret,则直接填写你在那里写的密钥
        let request_key = '你的密钥';
// 过期时间戳，超过时间戳密钥无效。
        let time = (Date.now() + 365 * 1 * 1000 * 60 * 60 * 24).toString();
        let uname = time + ':' + username;
        let hmac = crypto.createHmac("sha1", request_key);
        let result = hmac.update(uname).digest("Base64");
        return {
            username: uname,
            credential: result
        }
    }

// 生成的config再通过socket回传给客户端，客户端用此作为config创建PeerConnection
let key=getKey(用户名);
// 发送配置
socket.emit("CONFIG_FEEDBACK", {
            config: {
                iceServers: [
                    {
                        urls: "turn:你的turn服务器:3478?transport=udp",
                        username: key.username,
                        credential: key.credential,
                    },
                    {
                        urls: "turn:你的turn服务器:3478?transport=tcp",
                        username: key.username,
                        credential: key.credential,
                    },
                    { urls: "stun:你的stun服务器:3478" },
                ],

            }
        });
```

如何测试我的TURN/STUN服务器是否成功？

_keyboard\_arrow\_down_

官方测试工具：https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/ 看结果里的relay一行，如果和你的turn服务器相同，则配置成功

> _warning_ 关于端口  
> **TURN/STUN服务器默认端口3478，但事实上中继的时候可能会使用大量高位端口。建议在系统防火墙和云服务商安全组把TCP和UDP的出流量全部放开。**

至此，服务端搭建完毕，可以快乐的投屏了！

本人才疏学浅，有些位置可能理解不到位，还请大佬纠正和包含，有什么疑问欢迎留言或mail：dorapocket@qq.com，我会不定时回复~