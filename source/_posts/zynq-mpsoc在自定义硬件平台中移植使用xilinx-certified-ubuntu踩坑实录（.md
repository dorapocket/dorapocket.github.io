---
title: Zynq MPSoC在自定义硬件平台中移植使用Xilinx Certified Ubuntu踩坑实录（以ZCU102为例）
tags:
  - Ubuntu
  - Xilinx
  - Zynq
id: '227'
categories:
  - - 其他
date: 2022-08-02 17:27:46
---

## 前言

在Zynq中移植Linux一直是对于我们这种初学者来说的老大难问题，这一问题在官方推出Petalinux后有所缓解。但Petalinux OS的操作简便性不如已经十分成熟的桌面系统Ubuntu，目前网上的教程大多侧重于利用Petalinux生成完设备树和内核后替换Ubuntu的rootfs。事实上，在Vitis AI横空出世后，Xilinx给出了一个已经为Zynq MPSoc移植好的Ubuntu，并起名为**Xilinx Certified Ubuntu**。该版本是一个Golden镜像，可以将大多数硬件接口驱动起来。但如果想在PL端作出修改并在Linux中驱动起来，则需要自己重构设备树和Bitstream。利用**Xilinx Certified Ubuntu**的好处还有：

什么是rootfs？

_keyboard\_arrow\_down_

rootfs又叫根文件系统，是Linux启动后挂载的第一个文件系统，然后再从其中读取初始化脚本。一个可以使用的Linux大体分为三部分：Bootloader+Linux Kernel+rootfs。目前的Linux发行版都采用内核和发行版分离的方式，替换rootfs就可以实现替换Linux发行版。

*   提供xlnx-config、fpga-manager-xlnx、bootgen-xlnx等多种工具的snap镜像，实现在linux端管理PL资源。
*   利用xlnx-config，实现各种配置好的平台资源（PAC）的切换，并自动生成Boot镜像，重启后直接生效。
*   对于因编写出错无法引导的镜像，将再重启后尝试引导失败后回滚为Golden镜像。
*   More

本文将一步步从裸板上实现Xilinx Certified Ubuntu安装、自定义硬件平台设计、构建自定义平台资产（PAC）、硬件资产在Linux上进行切换等步骤。作为学习记录，也希望对大家有帮助。

## Step1：安装并启动Xilinx Certified Ubuntu

访问Ubuntu官方网站下载固件：[https://ubuntu.com/download/amd-xilinx](https://ubuntu.com/download/amd-xilinx)

截止发文时，最新的固件为20.04LTS。下文将以20.04LTS为例。

将SD卡插入读卡器，将下载下来的.xz压缩包解压成img，利用镜像烧写工具将下载下来的镜像烧写到SD卡上。（推荐[balenaEtcher](https://www.balena.io/etcher/)，各操作系统通用）。

插入电源、USB-UART连接线、SD卡，有显示器和键盘啥的也可以插上。**调整ZCU102上的SW6开关**到下图所示（来自UG1182官方文档，尤其注意官方文档的Pins序号是\[4:1\]不是\[1:4\]...当时坑死我了调了半天）

![](https://lgyserver.top/wp-content/uploads/2022/08/Dingtalk_20220802100823.jpg)

官方手册的指示

![](https://lgyserver.top/wp-content/uploads/2022/08/2.jpg)

实际位置

将UART连接到电脑（前提是装好CP210X串口芯片的驱动）后可以看到端口多了4个，打开Interface 0（波特率115200，8位数据，1位停止，无校验位），打开电源，看看有没有串口信息打印出来。

![](https://lgyserver.top/wp-content/uploads/2022/08/3.jpg)

串口

一切正常的话就能看到Ubuntu系统已经引导成功了。用户名密码都是ubuntu。

下面让我们仔细分析一下启动流程，来方便我们日后用自己的硬件平台替换。

![](https://lgyserver.top/wp-content/uploads/2022/08/fef17dba-24ac-411d-a0a6-a81879078a2c-255x1024.png)

启动过程

SD卡内的文件如下：

*   boot.bin （板子识别和镜像选择ImgSel）
*   boot 10(2,4,6)1.bin （ZCU102/104/106专用镜像）
*   boot.scr.uimg （Uboot）
*   image.fit
*   meta-data,network-config,user-data （linux需要的数据）

Xilinx在启动时，BootROM会先检测设备模式引脚状态，SD卡启动时会搜SD卡第一个分区有无**boot.bin**，如果没有则在后面加数字，搜索boot1.bin,boot2.bin...一直到**boot8191.bin**，这种模式被称为**MultiBoot**。在Certified Ubuntu中，boot.bin是一个最小的应用程序（[ImgSel](https://github.com/Xilinx/embeddedsw/tree/master/lib/sw_apps/imgsel)），用于确定是在哪个板子上运行，随后把boot过程移交给更强大的FSBL执行。在本例中，ImgSel检测到了102板子，将1020写入MultiBoot寄存器，BootROM从boot1020.bin开始找，最终找到boot1021.bin(转为ZCU102设计的Golden镜像)启动。前文所说的利用xlnx-config进行镜像管理，本质上就是打包boot1020.bin并写入SD卡，在boot1020.bin失效后自动回滚会Golden镜像boot1021.bin。

具体启动参考右图（源于参考\[2\]）

## Step2 用Vivado创建自己的硬件平台

打开Vivado，选择ZCU102板，Create Block Design.

*   添加一个Zynq核心，先Run Block Automation，弹出窗口内选择Apply Board Preset，这样后面可以少配很多东西。
*   添加一个AXI GPIO用于测试读写开发板引脚，一个AXI BRAM Controller用于BRAM测试。
*   Generate Block Design -> 右键单击bd -> Create HDL Wrapper
*   写约束
*   Generate Bitstream
*   File -> Export Hardware 导出xsa

打开Vitis，新建一个Platform Project，选择刚刚导出的xsa。

构建该Platform Project

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-121425.jpg)

构建

构建成功后，取出下列两个文件

*   /zynqmp\_fsbl/fsbl\_a53.elf
*   /zynqmp\_pmufw/pmufw.elf

接着，进行设备树导出。

如果你第一次进行这个操作，需要在任意位置拉取Xilinx的Device Tree Generator，不然会报错。

```
git clone https://github.com/Xilinx/device-tree-xlnx
cd device-tree-xlnx
git checkout <你的套件版本，如xlnx_rel_v2021.2>
```

在Vitis中，选择Xilinx->Software Repositories，添加刚刚拉取的仓库本地文件夹地址

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-122300.jpg)

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-122426.jpg)

接着，选择Xilinx->Generate Device Tree，选择xsa，并配置导出文件夹。

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-122512.jpg)

生成的文件如图，因为XSA文件仅包含用户定义的IP和Zynq，因此要激活Ethernet网络，需要自己编写设备树，修改其中的system-top.dts来添加Ethernet的PHY（踩坑\*n）同时还需要加入model和compatible字段来让Uboot/Ubuntu正确识别硬件开发板信息、加载驱动程序（再次踩坑）。（参考：https://github.com/Xilinx/u-boot-xlnx/blob/3113b53d8cb1913ef8162cadf45f44ebf2ed9eea/arch/arm/dts/zynqmp-zcu102-revA.dts）

```
/dts-v1/;
#include "zynqmp.dtsi"
#include "zynqmp-clk-ccf.dtsi"
#include "pl.dtsi"
#include "pcw.dtsi"

/ {
model = "ZynqMP ZCU102 Rev1.1";
compatible = "xlnx,zynqmp-zcu102-rev1.1", "xlnx,zynqmp-zcu102", "xlnx,zynqmp";
chosen {
bootargs = "earlycon";
stdout-path = "serial0:115200n8";
};
aliases {
ethernet0 = &gem3;
i2c0 = &i2c0;
i2c1 = &i2c1;
serial0 = &uart0;
serial1 = &uart1;
spi0 = &qspi;
};
memory {
device_type = "memory";
reg = <0x0 0x0 0x0 0x7ff00000>, <0x00000008 0x00000000 0x0 0x80000000>;
};
};

&gem3 {
status = "okay";
phy-handle = <&phy0>;
phy-mode = "rgmii-id";
pinctrl-names = "default";
phy0: ethernet-phy@c {
reg = <0xc>;
ti,rx-internal-delay = <0x8>;
ti,tx-internal-delay = <0xa>;
ti,fifo-depth = <0x1>;
ti,dp83867-rxctrl-strap-quirk;
/* reset-gpios = <&tca6416_u97 6 GPIO_ACTIVE_LOW>; */
};
};
```

接着，来编译设备树Blob文件（DTB），进入生成的设备树目录。该步骤需要在Linux系统下进行。

```
gcc -I my_dts -E -nostdinc -undef -D__DTS__ -x assembler-with-cpp -o system-top.dts.tmp system-top.dts

dtc -I dts -O dtb -o system-top.dtb system-top.dts.tmp
```

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-142227.jpg)

至此，在文件夹内出现设备树文件system-top.dtb，进行保存

接下来，编译ARM可信固件（ATF）

```
git clone https://github.com/Xilinx/arm-trusted-firmware.git
cd arm-trusted-firmware
```

这个存储库里面有个软连接到linux库，遇到报错要自己删了软连接重建一下，具体是哪个我忘记了。。处理完以后

```
make CROSS_COMPILE=aarch64-none-elf- PLAT=zynqmp RESET_TO_BL31=1
```

来进行交叉编译，编译好会生成bl31.elf，保存下来。

现在我们有这些文件：

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-143442.jpg)

把Vivado生成的PL Bitstream也保存到这里，命名为system.bit。接下来，我们新建一个文件，命名为bootgen.bif，内容如下：

```
the_ROM_image:
{
        [bootloader, destination_cpu=a53-0] fsbl_a53.elf
        [pmufw_image] pmufw.elf
        [destination_device=pl] system.bit
        [destination_cpu=a53-0, exception_level=el-3, trustzone] bl31.elf
        [destination_cpu=a53-0, load=0x00100000] system-top.dtb
        [destination_cpu=a53-0, exception_level=el-2] /usr/lib/u-boot/xilinx_zynqmp_virt/u-boot.elf
}
```

这些文件的意义，Xilinx Wiki有相应介绍。

bootgen.bif

用于生成boot.bin的描述文件

fsbl\_a53.elf

First Stage Bootloader

system.bit

PL的Bitstream文件

bl31.elf

ARM可信固件

system-top.dtb

设备树文件，需要与system.bit对应

uboot.elf

u-boot文件，对于ZCU102，可以直接使用Certified Ubuntu系统内 /usr/lib/u-boot/xilinx\_zynqmp\_virt/u-boot.elf

dpu.xclbin

(可选) system.bit的DPU配置

pmufw.elf

Platform Management Unit (PMU)固件

前面讲了这么多，之后我们替换新的硬件平台的时候只要考虑system.bit、system-top.dtb、dpu.xclbin就可以了，其他的build都是**一劳永逸**的。

或者你是在不想build，对于fsbl、bl31，都可以使用Certified Ubuntu内的golden镜像，存储路径在：

```
/usr/share/xlnx-firmware/zcu10[x]
```

接下来，我们按照xlnx-config工具的要求将上述文件按如下存放(其中，test\_pac文件夹存放在/boot/firmware/xlnx-config中。因为/boot/firmware就是SD卡的挂载点，所以也可以直接在SD卡上操作)

```
test_pac/
└── hwconfig
    ├── test_pac
    │   ├── manifest.yaml
    │   ├── zcu102
    │   │   ├── bl31.elf
    │   │   ├── bootgen.bif
    │   │   ├── fsbl_a53.elf
    │   │   ├── pmufw.elf
    │   │   ├── system.bit
    │   │   └── system-top.dtb
```

manifest.yaml内如下：

```
name: test_platform
desscription: Boot assets for the 2021.2 test design
revision: 1
assets:
        zcu102: zcu102
```

## Step 3 激活自定义硬件平台（PAC）

首先需要安装Xilinx官方的工具xlnx-config（snap拉取的失败率挺高的。。）

```
sudo snap install xlnx-config --classic --channel=1.x
xlnx-config.sysinit
```

如果没有snap，要先安装snap，再执行上述操作

```
sudo snap install snap-store
```

安装完毕后，输入 xlnx-config -q 可以看见刚刚我们设置的自定义硬件平台

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-150223-1024x231.jpg)

使用 sudo xlnx-config -a test\_pac 激活我们刚刚设置的平台，工具会自动打包成boot.bin并放到SD卡命名为boot1020.bin。重启后生效。

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-150433.jpg)

重启后，可以通过xlnx-config -q查看激活的资产

![](https://lgyserver.top/wp-content/uploads/2022/08/屏幕截图-2022-08-02-150752-1024x186.jpg)

## 参考

\[1\] [Getting Started with Certified Ubuntu 20.04 LTS for Xilinx Devices](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/2037317633/Getting+Started+with+Certified+Ubuntu+20.04+LTS+for+Xilinx+Devices)

\[2\] [Booting Certified Ubuntu 20.04 LTS for Xilinx Devices](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/2036826124/Booting+Certified+Ubuntu+20.04+LTS+for+Xilinx+Devices)

\[3\] [Build ARM Trusted Firmware (ATF)](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/18842305/Build+ARM+Trusted+Firmware+ATF)

\[4\] [Snaps - xlnx-config Snap for Certified Ubuntu on Xilinx Devices](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/2057043969/Snaps+-+xlnx-config+Snap+for+Certified+Ubuntu+on+Xilinx+Devices)

\[5\] [Xilinx](https://github.com/Xilinx)/**[embeddedsw](https://github.com/Xilinx/embeddedsw)**

\[6\] [Xilinx](https://github.com/Xilinx)/**[linux-xlnx](https://github.com/Xilinx/linux-xlnx)**

\[7\] [Device Trees](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/862421121/Device+Trees)

\[8\] [Solution ZynqMP PL Programming](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/18841847/Solution+ZynqMP+PL+Programming)

\[9\] [Creating Devicetree from Devicetree Generator for Zynq Ultrascale and Zynq 7000](https://xilinx-wiki.atlassian.net/wiki/spaces/A/pages/136904764/Creating+Devicetree+from+Devicetree+Generator+for+Zynq+Ultrascale+and+Zynq+7000)

\[10\] [Xilinx](https://github.com/Xilinx)/**[u-boot-xlnx](https://github.com/Xilinx/u-boot-xlnx)**