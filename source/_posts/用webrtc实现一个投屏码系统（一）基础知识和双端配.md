---
title: 用WebRTC实现一个投屏码系统（一）基础知识和双端配置
tags:
  - WebRTC
  - 前端开发
  - 投屏
id: '100'
categories:
  - - 前端
date: 2021-01-13 21:20:34
---

WebRTC（Web Real-Time Communication）是为了让开发者在浏览器实现多媒体交换的技术，于2011年被加入W3C规范。当前的支持情况可以见下图。

![](https://lgyserver.top/wp-content/uploads/2021/01/image-1024x486.png)

WebRTC的核心在于建立PeerConnection实现视频流双端链接，要想理解WebRTC的工作流程，有如下后端服务的概念需要理解：

*   信令（Signal）服务器
*   TURN/STUN服务器
*   房间服务器
*   ICE候选者

视频流的传输不是纯前端的工作（显然），然而WebRTC的规范只规定了前端的部分，后端的信令传输不在WebRTC的范围之内，可以随开发者需求自行开发。

* * *

下图展现了WebRTC的工作流程

![](https://lgyserver.top/wp-content/uploads/2021/01/250050215053233.png)

**信令服务器**（图中黄色部分）主要作用是连接建立前的中转工作。需要自行用websocket实现。

**STUN**（**Session Traversal Utilities for NAT**，NAT会话穿越应用程序）允许位于NAT（或多重NAT）后的客户端找出自己的公网地址，查出自己位于哪种类型的NAT之后以及NAT为某一个本地端口所绑定的Internet端端口。这些信息被用来在两个同时处于NAT路由器之后的主机之间创建UDP通信。该协议由RFC 5389定义。

**TURN**（**Traversal Using Relay NAT**，通过Relay方式穿越NAT），TURN应用模型通过分配TURNServer的地址和端口作为客户端对外的接受地址和端口，即私网用户发出的报文都要经过TURNServer进行Relay转发。解决了STUN应用无法穿透对称NAT（SymmetricNAT）以及类似的防火墙的缺陷。

当STUN无法直接建立P2P时，便可以用TURN进行中转。

**房间服务器** 和RTC的建立并无直接关系。但考虑到不可能你的服务只能同时支持一对电脑链接，我们必须设置“房间”。在本项目中，我们的“房间”号码就是投屏码。在投屏码投屏的应用逻辑中，被叫方（投屏屏幕）首先用投屏码向房间服务器注册，客户端（请求投屏方）输入正确的投屏码后加入“房间”。自此，RTC之后的信令交换都只在这个“房间”内完成，使服务支持多对计算机互联。在实际实现中，房间服务器和信令服务器可以由同一服务完成。

**ICE**（**Interactive Connectivity Establishment**，互动式连接建立）提供一种框架，使各种NAT穿透技术可以实现统一。该技术可以让基于SIP的VoIP客户端成功地穿透远程用户与网络之间可能存在的各类防火墙。

具体建立流程描述如下：

1、在连接建立之前，双方不知道彼此，因此都需要向信令服务器进行注册。随后，发起方创建PeerConnection，调用WebRTC的createOffer方法将**SDP**（**Session Description Protocol**，理解为自己的一个“描述”）传输给信令服务器，由信令服务器做中继传递给被叫方。

2、被叫方收到Offer以后，调用createAnswer方法生成针对发起方Offer的响应。并通过信令服务器发回呼叫方。此时双方均保存有两个Description（对于呼叫方是自己的offer和对面的answer，对于接收方是对面的offer和自己的answer）

3、交换完Offer后需要进行ICE交换，ICE交换同样也要利用信令服务器进行交换。在设置完双方Description之后，发起方会自动向配置的STUN服务器请求自己的ip和端口，STUN服务器会返回可能可用的ICE-Candidate。发起方收到Candidate后需要将其通过信令发送到被叫方。被叫方设定成自己的ICE-Candidate。与此同时，被叫方也需要向STUN服务器发起ICE请求流程，把自己的ICE候选者发送给发起方。双方经过多次“协商”后最终选定ICE的交集进行连接。这也就体现了双方的“互动”。

4、交换完ICE候选者后，P2P的PeerConnection建立完成，就可以传输各种媒体信息了。在实际测试中ICE的交换并不一定在收到Answer后才触发，是可以提前触发的。

* * *

## 呼叫端的流程

0、加个按钮吧！

输入“投屏码”，和屏幕端加入同一个“房间”，以便于进行信令交换！点击按钮后，运行如下代码：也就是说，以下所有的代码，都是在你点击这个按钮后运行的。

```
socket = io.connect("你的信令服务器地址");
socket.on("connect", function () {
  socket.emit("CONNECT_TO_TV", {
    username: "lgy",
    projCode: store.projCode.toUpperCase(),
  });
});
```

在这里，我们建立了socket链接，并告诉了服务器我们想加入的“房间”。connect事件在建立连接后自动触发。（我的考虑是点击“链接”按钮再建立链接，而不是一直长连接着，这个链接专门用于RTC流程建立，也就是说点击“链接”前，下文的过程都不会进行。只有点击按钮后，才会有以下的流程）

1、建立PeerConnection对象

```
const configuration = {
  iceServers: [
    {
      urls: "turn:你的turn服务器地址，端口一般是3478",
      username: "turn用户名",
      credential: "turn密码",
    },
    { urls: "stun:你的stun服务器地址，端口一般是3478" },
  ],
  iceCandidatePoolSize: 2,
};
const peerConnection = new RTCPeerConnection(configuration);
```

建立RTCPeerConnection是应该传入候选iceServer，其中turnServer由于协议规定，必须有username和credential字段，stunServer不需要身份验证。详情可以参考MDN [RTCPeerConnection](https://developer.mozilla.org/zh-CN/docs/Web/API/RTCPeerConnection/RTCPeerConnection)文档

2、捕获视频流

```
const transferStream = await navigator.mediaDevices.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: Screensources[screenid].id,
              minWidth: 640,
              maxWidth: 1920,
              minHeight: 360,
              maxHeight: 1080,
            },
          },
        });
```

在这里，我们利用getUserMedia获取到了视频流MediaStream对象，若要同时获取音频，可以再增加audio选项，详情->[getUserMedia](https://developer.mozilla.org/zh-CN/docs/Web/API/MediaDevices/getUserMedia)

> __ 何时获取视频流？  
> **请注意，您不必现在就获取视频流，getUserMedia()会返回一个Promise，因此这里采用了await的写法，但是您最好提前声明一个MediaStream对象，因为在Offer生成之前媒体流必须添加到PeerConnection中，详见 https://stackoverflow.com/questions/17391750/remote-videostream-not-working-with-webrtc**

3、创建Offer

```
// 重要！在生成offer前确保已添加视频流，不然可能连接建立完成后无法触发对面的onaddstream监听器。
peerConnection.addStream(transferStream);
 
const offer = await peerConnection.createOffer({
  offerToReceiveVideo: 1,
 // 已过时，最好用RTCRtpTransceiver替代
});
await peerConnection.setLocalDescription(offer);
 // 设置自己的Description
// 发送websocket到信令服务器
socket.emit("RTC_Client_Offer_To_Server", {
  offer: offer,
});
```

> __ 关于addStream和offerToReceiveVideo  
> **根据最新的规范，addStream和offerToReceiveVideo两处已经过时，根据官方建议（https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addstream\_event），还是采用最新的addTrack和RTCRtpTransceiver来替换为好。详见下文**

这里有几点需要注意：

*   请在连接建立之前为peerConnection添加stream或tracks
*   请在调用createOffer时参数务必传入offerToReceiveVideo或设置RTCRtpTransceiver。您可以console.log()您的offer查看，若您的描述十分的短（只有一两行）大概率是没有设置该参数，正常情况下offer应该有几十行。而且没有设置该参数会导致无法触发ICE的收集工作，因而无法触发onicecandidate事件（将在后文提到）。

若采用track的写法，addStream应该这样写：

```
transferStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, transferStream);
});
```

你可能已经注意到我们在这里用了socket.emit这一个函数来发送Offer，这是Socket.IO的使用方法，在本项目中我使用了Node.js用做websocket链接，调用Socket.IO这个包。先不用管这是干嘛的，他就是向信令服务器发送了一个指令，要求传送第二个参数（就是Offer）的内容。

4、注册事件监听器

首先注册ICE监听器。当Offer正常交换完成后，会自动触发ICE的收集，收集过后的结果会触发onicecandidate监听器。我们要做的很简单——拿到这个ICE收集结果，并通过类似的方式通过信令服务器传递给接收方。

```
peerConnection.onicecandidate = function (event) {
       console.log(event);
       if (event.candidate) {
         socket.emit("RTC_Candidate_Exchange", {
           iceCandidate: event.candidate,
         });
       }
};
// 或者你也可以用监听器的写法：
peerConnection.addEventListener('icecandidate', event => {
       console.log(event);
       if (event.candidate) {
         socket.emit("RTC_Candidate_Exchange", {
           iceCandidate: event.candidate,
         });
       }
})
```

websocket向信令服务器发送了RTC\_Candidate\_Exchange指令，并传递了从事件中获取的ICE候选人信息。

接着注册ICE接收器，当收到对面的ICE候选人信息时，我们要将它添加到自己的ICE候选人列表。

```
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

当收到信令服务器主题为RTC\_Candidate\_Exchange的消息时，取出消息中的ICE候选者，使用addIceCandidate加入到自己的列表。

也不能忘记注册Answer接收器——当对面收到了我们的Offer，把Answer发送过来时，添加到RemoteDescription中

```
socket.on("RTC_TV_Answer_To_Client", async (msg) => {
        if (msg.answer) {
            const remoteDesc = new RTCSessionDescription(msg.answer);
            await peerConnection.setRemoteDescription(remoteDesc);
            console.log("RTC TV answer received", peerConnection);
        }
});
```

在这里，我们使用RTCSessionDescription包裹了Answer，并将它通过setRemoteDescription（注意最开始的Offer是setLocalDescription，不要搞混）方法加入到了peerConnection中。

事实上到这里必要的工作已经准备完成，但是你肯定想知道你的链接建立的状态，因此我们再注册一个状态监听器来反馈连接的状态：

```
peerConnection.onconnectionstatechange = function (event) {
    console.log(
      "RTC Connection State Change :",
      peerConnection.connectionState
    );
};
```

* * *

## 被叫端的流程

前面提到，我们需要让服务器加入以其投屏码命名的“房间”以便信令交互。所以我们可以让页面生成投屏码后向服务器发起Socket注册。

```
// 发送注册请求，可以携带你想要的数据。
socket.on("connect", function () {
  socket.emit("TV_REGISTER");
});
// 注册成功后服务器发起TV_REGISTER_SUCCESS事件并传回生成的投屏码
socket.on("TV_REGISTER_SUCCESS", function (config) {
  that.code = config.projCode  "获取投屏码失败";
  console.log("Regist Successful, config:", config);
});
```

第一条“connect”是定义好的事件，将在socket建立成功后触发。我在这里的思路是服务器生成投屏码，再下发过去。当然也可以TV生成然后去服务器“报备”。（默默说一句其实我觉得客户端生成好，要不然断链以后服务端很可能返回另一个投屏码，在网络不好的环境下每次重连都是新的房间就没办法实现自动恢复了，打算之后有空改一下，生成以后存在localStorage里）

被叫端和呼叫端差不多，甚至更为简单。大部分由注册的监听器来完成

首先我们需要创建RTCPeerConnection

```
peerConnection = new RTCPeerConnection(configuration);
```

我们需要收到呼叫端的Offer并创建Answer：

```
socket.on("RTC_Client_Offer_To_TV", async (data) => {
  console.log("RTC_Client_Offer_To_TV");
  if (data.offer) {
    peerConnection.setRemoteDescription(
      new RTCSessionDescription(data.offer)
    );
 // 是呼叫方的Offer，放Remote
    // 创建Answer，并保存为Local
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    // 利用信令回复Answer
    socket.emit("RTC_TV_Answer_To_Server", { answer: answer });
  }
});
```

我们通过注册一个socket事件，当服务器返回RTC\_Client\_Offer\_To\_TV事件时，提取出Offer并保存，生成Answer并发布RTC\_TV\_Answer\_To\_Server事件让服务器转发给发起端。

类似于呼叫方，注册ICE事件监听器和RTC状态变化监听器（见呼叫方代码，一模一样）

此外，我们需要将视频流提取出来，并作为视频源给到到页面上的video元素中。

```
peerConnection.onaddstream = (event) => {
    player = document.getElementById('video');
    player.srcObject = event.stream;
}

// 若您在呼叫方使用Track而不是用Stram，则注册这个
peerConnection.addEventListener('track', async (event) => {
    player = document.getElementById('video');
    player.srcObject = remoteStream;
    remoteStream.addTrack(event.track, remoteStream);
});
```

* * *

至此，所有的客户端和投屏端配置已经完成。接下来就要进行后端服务器开发了。我将会在以后的文章中写如何建立websocket信令服务和如何部署TURN/STUN服务器并解释TURN服务器的动态身份验证机制。感谢阅读。