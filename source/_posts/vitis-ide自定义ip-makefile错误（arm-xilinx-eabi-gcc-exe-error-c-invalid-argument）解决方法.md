---
title: >-
  Vitis IDE自定义IP Makefile错误（arm-xilinx-eabi-gcc.exe: error: *.c: Invalid
  argument）解决方法
tags:
  - FPGA
  - Vitis
  - Xilinx
  - Zynq
id: '177'
categories:
  - - 嵌入式
date: 2022-03-26 11:12:41
---

天下苦Vitis久矣，在做开发的时候有时候会遇见自定义IP以后生成驱动的Makefile有问题，导致hello world都编译不通过的情况，Xilinx的官方论坛只给出了部分makefile解决方法，写的也不是很清楚，特此记录。

要解决的错误类似于：

```
"Compiling my_ip..."
arm-xilinx-eabi-gcc.exe: error: *.c: Invalid argument
arm-xilinx-eabi-gcc.exe: fatal error: no input files
compilation terminated.
```

首先找到这个路径

```
${hardwareplatform的名字}/zynq_fsbl/zynq_fsbl_bsp/${ps7_cortexa9_0(核心名字)}/libsrc/${(ip名字)}/src/Makefile 
```

替换为

```
COMPILER=
ARCHIVER=
CP=cp
COMPILER_FLAGS=
EXTRA_COMPILER_FLAGS=
LIB=libxil.a
RELEASEDIR=../../../lib
INCLUDEDIR=../../../include
INCLUDES=-I./. -I${INCLUDEDIR}
INCLUDEFILES=$(wildcard *.h)
LIBSOURCES=$(wildcard *.c *.cpp)
OUTS =*.o
OBJECTS = $(addsuffix .o, $(basename $(wildcard *.c *.cpp)))
ASSEMBLY_OBJECTS = $(addsuffix .o, $(basename $(wildcard *.S)))
libs:
echo "Compiling myip"
$(COMPILER) $(COMPILER_FLAGS) $(EXTRA_COMPILER_FLAGS) $(INCLUDES) $(LIBSOURCES)
$(ARCHIVER) -r ${RELEASEDIR}/${LIB} ${OBJECTS} ${ASSEMBLY_OBJECTS}
make clean
include:
${CP} $(INCLUDEFILES) $(INCLUDEDIR)
clean:
rm -rf ${OBJECTS} ${ASSEMBLY_OBJECTS}
```

然后重新编译，顺利的话直接就好了，不顺利的话看报错的下一句有 exiting dir xxx 来定位哪个Makefile错了，接着改。

接着build application的时候有可能会爆一个qemu\_args报错：  
解决方法：在hardwareplatform里面增加export/name/sw/name/qemu/qemu\_args.txt 内容留空即可

最后，如果build的时候出现unreferenced Xout\_32，就增加头文件 xil\_io.h

这样就可以了。