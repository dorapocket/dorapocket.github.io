---
title: 前端拦截Image的src并返回原生对象
tags:
  - 前端
id: '117'
categories:
  - - 前端
date: 2021-06-29 23:06:23
---

做框架的时候因为跨域问题，需要将用户的请求目标进行hook，拦截用户代码的Image.src操作并重定向到自己的url进行代理访问。为此进行了一些研究。

解决方案：

*   利用Proxy包装并返回Proxy，通过handler拦截。
*   利用Object.defineProperty监听变化并拦截

利用Proxy方法拦截有个弊端，由于返回的是Proxy对象，虽然能够拦截src并进行修改，但是将无法通过drawImage绘制到Canvas上。

正常的绘制方法：

```
let canvas2d = document.createElement('canvas').getContext('2d')
let img = new Image()
image.src='a.jpg'
// image会自动请求
image.onload = ()=>{
  canvas2d.drawImage(img,0,0)
  // 成功绘制
}
```

加了Proxy拦截之后：

```
function hookFunction(src){
  // hook的url
}
function FakeImage(){
  const img = new Image()
  const handler = {
    set(obj, prop, value) {
    if ((prop === 'src')) {
      console.log('Hook set src',value);
      obj[prop] = hookFunction(src)
    } else {
      return Reflect.set(...arguments);
    }
  }
  }
  return new Proxy(img,handler)
}

let canvas2d = document.createElement('canvas').getContext('2d')
let img = new FakeImage()
image.src='a.jpg'
// image会自动请求
image.onload = ()=>{
  canvas2d.drawImage(img,0,0)
  // 绘制出错，img为Proxy对象，不是HTMLImageElement
}
```

虽然更改了src但无法绘制到canvas上，我的解决办法是利用Object.defineProperty。

```
function hookFunction(src){
  // hook的url
}
function FakeImage(){
  const img = new Image()

  // 保存原有的setter
  const originalSet = Object.getOwnPropertyDescriptor(img.__proto__,'src').set

  Object.defineProperty(img,'src',{
    set:(src)=>{
      console.log('Hook set src',value)
      // call原来的setter以触发自动请求
      originalSet.call(img,value)
    }
  })
  return img
}

let canvas2d = document.createElement('canvas').getContext('2d')
let img = new FakeImage()
image.src='a.jpg'
// image会自动请求
image.onload = ()=>{
  canvas2d.drawImage(img,0,0)
  // 绘制成功且hook成功
}
```

> _warning_ 一定要记得保存原有的setter  
> **在defineProperty设置setter之前，先通过Object.getOwnPropertyDescriptor保存原来的setter，否则无法触发image元素的自动请求！！特别注意，被坑了好久！**