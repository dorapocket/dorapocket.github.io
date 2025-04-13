---
title: Zynq学习笔记-AXI DMA(Scatter/Gather)模式
tags:
  - AXI
  - DMA
  - FPGA
  - Xilinx
  - Zynq
id: '168'
categories:
  - - 嵌入式
date: 2022-03-22 20:27:59
---

若您第一次使用DMA，请先熟悉简单的DMA(运行在SimpleMode/Direct Register)下的DMA存储

## 一、Scatter/Gather模式简介

**AXI DMA**操作需要先提供一个在内存中驻留的不变空间，用于存储需要进行的DMA操作。形容这“每一次操作”的东西叫做Buffer Descriptor，缩写叫BD，这些BD是连接成链表的形式的，因为BD会动态增加，而预先分配存储BD的空间是恒定的，因此BD被连成一个环（BD Ring）,其实就是一个循环链表。

**Scatter/Gather** 允许一个数据包（Packet）由多个描述符（BD）来描述。官方文档指出的一个典型应用是在传输网络包时，Header和数据往往是分开存储的，利用SG模式可以较好的处理向多个目标读写的操作，提高应用吞吐量。 DB Ring中DB成链存放，为了解决环形结构带来的不知道Packet的起点和终点带来的问题，DMA使用了帧开始位 (TXSOF，TX Start of Frame bit) 和帧结束位 (TXEOF，TX End of Frame Bit)来分辨一段Packet。 当 DMA 获取设置了 TXSOF 位的描述符时，将触发Packet的开始。 Packet继续获取后续描述符，直到它获取一个设置了 TXEOF 位的描述符。

在接收 (S2MM) 通道上，当开始接收数据包时，AXI DMA会自动使用 RXSOF 标记描述符，告诉软件部分这个描述符对应的buffer是一个数据包的开头。 如果正在接收的数据包的总字节数比描述符中指定的长，则用下一个描述符接着传。 这种获取和存储过程一直持续到整个接收数据包被传输完毕。 接收到数据包结尾时正在处理的描述符由AXI DMA自动标记为RXEOF=1。表明与该描述符关联的缓冲区包含数据包的结尾。

每个描述符内部指明了该特定描述符实际传输的字节数。 软件可以通过从 RXSOF 描述符通过描述符链到 RXEOF 描述符来确定为接收数据包传输的总字节数。

Scatter Gather 操作从设置控制寄存器和描述符指针开始。

设置和启动 MM2S 通道的 DMA 具体操作如下：

*   将起始描述符的位置写入Current Descriptor寄存器中
*   设置运行/停止位为1（MM2S\_DMACR.RS=1）启动MM2S运行
*   (可选)启用中断（MM2S\_DMACR.IOC\_IrqEn 和 MM2S\_DMACR.Err\_IrqEn）
*   将末尾描述符位置写入Tail Descriptor寄存器中，写入后会立刻触发DMA获取描述符，如果是多通道，这一步骤会在数据包到达S2MM时开始
*   处理当前描述符，从内存中读取数据并转化成Stream输出

S2MM通道的配置类似：

*   将起始描述符的位置写入Current Descriptor寄存器中
*   通过将运行/停止位设置为 1 (S2MM\_DMACR.RS =1) 来启动 S2MM 通道运行，并且暂停位 (DMASR.Halted) 置低，指示 S2MM 通道正在运行
*   (可选)启用中断（MM2S\_DMACR.IOC\_IrqEn 和 MM2S\_DMACR.Err\_IrqEn）
*   将有效地址写入尾部描述符寄存器，自动触发 DMA 从内存获取描述符
*   处理获取的描述符，并将从 S2MM 流式通道接收到的任何数据写入内存

在SG模式下，AXI DMA控制寄存器映射有所不同，如下表所示

![](image-29.png)

AXI DMA Register Map

说了这么多，那一个描述符到底长啥样？

PG021第38页详细介绍了描述符内容。描述符由 8 个 32 位基本字和 0 或 5 个用户应用字组成。最大支持64位地址，通过帧开始和帧结束标志支持每个数据包的多个描述符。 还包括已完成状态和完成时中断。 缓冲区长度可以描述每个描述符最多 8,388,607 字节的数据缓冲区。 两个数据传输方向 MM2S 和 S2MM 需要两个描述符链。

![](image-26.png)

BD组成

前两个指示了接下来的BD位置，后面两个BUFFER\_ADDRESS指示了需要读取/写入的缓冲区位置。应用程序字段（APP0、APP1、APP2、APP3 和 APP4）仅在包含Control/Status流时起效（在AXI DMA IP可以配置），当不包含时，Scatter Gather 不会获取。

最重要的Control和Status字段，先来看MM2S的BD的CONTROL

![](image-27.png)

MM2S\_CONTROL

**Buffer Length** 指示传输缓冲区的大小（字节），表示了要在MM2S传输的字节数，在VIVADO IP配置中，有一项是Width of Buffer Length Register，就是来配置这个值的。文档还特意提到，在Micro DMA模式下，位数应该<=MM2S数据宽度/8\*猝发长度。 因为这26位是固定好预分配的，所以如果设置了长度小于26会降低资源利用率。

**TXSOF/TXEOF**指示这个描述符是一个packet的开始还是结束。前面已经提到过，如果一个描述符就能解决，那么两个都为1。

**RSVD**是保留部分，置0。

![](image-28.png)

MM2S\_STATUS

MM2S STATUS字段记录了DMA操作状态，如下：

Transferred Bytes 表示本次实际传输数据大小（字节），长度和上面的Width of Buffer Length Register匹配。在 Micro 模式下配置时，AXI\_DMA 不会更新这些字段。

DMAIntErr DMA出错标记，仅仅在目标缓冲区长度为0时置1，同时DMACR.RS=1,DMASR.Halted=1表示暂停。

DMASlvErr 从机错误，一般是设备错误，此时DMACR.RS=0

DMADecErr 解码错误，如描述符缓冲区指示的地址无效，DMACR.RS=0

Cmplt 完成标志 DMA已经完成相关传输时设定=1

上面是MM2S的，S2MM的也类似，暂时不多讲了。

## 二、带中断的SG模式Vitis设计

大体的设计和上篇文章中一样，唯一的区别是在AXI DMA的block design中需要将Scatter/Gather Mode打开。

![](image-30-1024x741.png)

ip核设置

另外，在此实验中我们不需要Control/Status端口，将其关闭。

观察IP核，多出了一个M\_AXI\_SG接口，通过AXI Interconnect连接到Zynq的ACP或者HP从端口即可。剩下的继续自动布线大法好。。。

主要是Vitis程序的设计。因为这里引入了中断，所以需要配置中断控制器，程序大体思路是，先组装好DMA Buffer Descriptor描述符（包括TX，RX），配置好中断响应，再让DMA开始传输。传输结束后进行数据比对来验证是否成功。

源代码如下：

```
#include "xaxidma.h"
#include "xparameters.h"
#include "xil_exception.h"
#include "xdebug.h"

#ifndef DEBUG
extern void xil_printf(const char *format, ...);
#endif

#include "xscugic.h" // 中断控制器



#define DDR_BASE_ADDRXPAR_PS7_DDR_0_S_AXI_BASEADDR // DDR基地址
#define MEM_BASE_ADDR(DDR_BASE_ADDR + 0x1000000)   // OCM基地址

#define RX_INTR_IDXPAR_FABRIC_AXIDMA_0_S2MM_INTROUT_VEC_ID // 把S2MM传输当作RX的中断
#define TX_INTR_IDXPAR_FABRIC_AXIDMA_0_MM2S_INTROUT_VEC_ID // 把MM2S传输当作TX的中断

// 分配存储BD链的空间
#define RX_BD_SPACE_BASE(MEM_BASE_ADDR)
#define RX_BD_SPACE_HIGH(MEM_BASE_ADDR + 0x0000FFFF)
#define TX_BD_SPACE_BASE(MEM_BASE_ADDR + 0x00010000)
#define TX_BD_SPACE_HIGH(MEM_BASE_ADDR + 0x0001FFFF)

// 指示要发送的起始缓冲区、要接受的目标缓冲区
#define TX_BUFFER_BASE(MEM_BASE_ADDR + 0x00100000)
#define RX_BUFFER_BASE(MEM_BASE_ADDR + 0x00300000)
#define RX_BUFFER_HIGH(MEM_BASE_ADDR + 0x004FFFFF)

// DMA出错后Reset等待超时时间
#define RESET_TIMEOUT_COUNTER10000

// 要传输的每个packet大小
#define MAX_PKT_LEN0x100

#define MARK_UNCACHEABLE        0x701

// 每个packet对应的BD数量
#define NUMBER_OF_BDS_PER_PKT12
// 一共要传输的packet个数
#define NUMBER_OF_PKTS_TO_TRANSFER 11
// 总共需要的BD总数
#define NUMBER_OF_BDS_TO_TRANSFER(NUMBER_OF_PKTS_TO_TRANSFER * \
NUMBER_OF_BDS_PER_PKT)

// 中断折叠，就是经过COALESCING_COUNT个传输结束以后发一次中断
// 这里设置成NUMBER_OF_PKTS_TO_TRANSFER，也就是全传输完了统一发一次
#define COALESCING_COUNTNUMBER_OF_PKTS_TO_TRANSFER
#define DELAY_TIMER_COUNT100

// 一些函数声明
static int CheckData(int Length, u8 StartValue);
static void TxCallBack(XAxiDma_BdRing * TxRingPtr);
static void TxIntrHandler(void *Callback);
static void RxCallBack(XAxiDma_BdRing * RxRingPtr);
static void RxIntrHandler(void *Callback);



static int SetupIntrSystem(XScuGic * IntcInstancePtr,
   XAxiDma * AxiDmaPtr, u16 TxIntrId, u16 RxIntrId);
static void DisableIntrSystem(XScuGic * IntcInstancePtr,
u16 TxIntrId, u16 RxIntrId);

static int RxSetup(XAxiDma * AxiDmaInstPtr);
static int TxSetup(XAxiDma * AxiDmaInstPtr);
static int SendPacket(XAxiDma * AxiDmaInstPtr);

// DMA
XAxiDma AxiDma;

// 终端控制器
static XScuGic Intc;
volatile int TxDone;
volatile int RxDone;
volatile int Error;

// 发送缓冲区地址，必须32位对齐
u32 *Packet = (u32 *) TX_BUFFER_BASE;


int main(void)
{
// 初始化DMA
int Status;
XAxiDma_Config *Config;
Config = XAxiDma_LookupConfig(XPAR_AXIDMA_0_DEVICE_ID);
if (!Config) {
xil_printf("No config found for %d\r\n", XPAR_AXIDMA_0_DEVICE_ID);
return XST_FAILURE;
}
XAxiDma_CfgInitialize(&AxiDma, Config);
if(!XAxiDma_HasSg(&AxiDma)) {
xil_printf("Device configured as Simple mode \r\n");
return XST_FAILURE;
}

//设定TX的BD参数，此操作后TX BDRing全是空的
Status = TxSetup(&AxiDma);

if (Status != XST_SUCCESS) {
xil_printf("Failed TX setup\r\n");
return XST_FAILURE;
}
// 设定RX的BD参数，此操作后RX的BD Ring记录了来数据要存的位置
Status = RxSetup(&AxiDma);
if (Status != XST_SUCCESS) {
xil_printf("Failed RX setup\r\n");
return XST_FAILURE;
}
// 设置中断
Status = SetupIntrSystem(&Intc, &AxiDma, TX_INTR_ID, RX_INTR_ID);
if (Status != XST_SUCCESS) {
xil_printf("Failed intr setup\r\n");
return XST_FAILURE;
}

//初始化完成总个数
TxDone = 0;
RxDone = 0;
Error = 0;

// 设置TX Ring的BD内容，提交到DMA控制器，正式开始发送
Status = SendPacket(&AxiDma);
if (Status != XST_SUCCESS) {
xil_printf("Failed send packet\r\n");
return XST_FAILURE;
}

// 一直等待所有BD完成 这里是中断方法所以不用轮询查找，cpu可以干别的事情，这里只做演示用了死循环
// 每一个中断来都会改变TXRXDone的值
while (((TxDone < NUMBER_OF_BDS_TO_TRANSFER) 
(RxDone < NUMBER_OF_BDS_TO_TRANSFER)) && !Error) {

}
if (Error) {
xil_printf("Failed test transmit%s done, "
"receive%s done\r\n", TxDone? "":" not",
RxDone? "":" not");
goto Done;
}else {
// 检查数据
Status = CheckData(MAX_PKT_LEN * NUMBER_OF_BDS_TO_TRANSFER,0xC);
if (Status != XST_SUCCESS) {
xil_printf("Data check failed\r\n");
goto Done;
}
xil_printf("Success\r\n");
}
DisableIntrSystem(&Intc, TX_INTR_ID, RX_INTR_ID);

Done:
if (Status != XST_SUCCESS) {
return XST_FAILURE;
}
return XST_SUCCESS;
}

static int CheckData(int Length, u8 StartValue)
{
u8 *RxPacket;
int Index = 0;
u8 Value;

RxPacket = (u8 *) RX_BUFFER_BASE;
Value = StartValue;

// 禁用cache！
Xil_DCacheInvalidateRange((UINTPTR)RxPacket, Length);

// 验证RX缓冲区的数据
for(Index = 0; Index < Length; Index++) {
if (RxPacket[Index] != Value) {
xil_printf("Data error %d: %x/%x\r\n",
    Index, RxPacket[Index], Value);

return XST_FAILURE;
}
Value = (Value + 1) & 0xFF;
}

return XST_SUCCESS;
}

// 在每个DMATX事务完成后中断回调，有设置折叠的话就是n次以后回调
static void TxCallBack(XAxiDma_BdRing * TxRingPtr)
{
int BdCount;
u32 BdSts;
XAxiDma_Bd *BdPtr;
XAxiDma_Bd *BdCurPtr;
int Status;
int Index;

// 获取已经处理完的描述符
BdCount = XAxiDma_BdRingFromHw(TxRingPtr, XAXIDMA_ALL_BDS, &BdPtr);

BdCurPtr = BdPtr;
for (Index = 0; Index < BdCount; Index++) {
// 检测描述符的Status部分，验证有无出错
BdSts = XAxiDma_BdGetSts(BdCurPtr);
if ((BdSts & XAXIDMA_BD_STS_ALL_ERR_MASK) 
    (!(BdSts & XAXIDMA_BD_STS_COMPLETE_MASK))) {
Error = 1;
break;
}

// 后续处理，如释放已经传输完的packet的TX缓冲区

// 从链表获取下一个BD
BdCurPtr = (XAxiDma_Bd *)XAxiDma_BdRingNext(TxRingPtr, BdCurPtr);
}

// 把这些BD释放，以便更多BD写入，给BDRing分配的空间是有限的，BD用完了要及时释放掉
// 这里的BD一定是连着的一串，所以只给cnt和ptr就行
Status = XAxiDma_BdRingFree(TxRingPtr, BdCount, BdPtr);
if (Status != XST_SUCCESS) {
Error = 1;
}

if(!Error) {
TxDone += BdCount;
}
}

// 处理硬件中断
static void TxIntrHandler(void *Callback)
{
XAxiDma_BdRing *TxRingPtr = (XAxiDma_BdRing *) Callback;
u32 IrqStatus;
int TimeOut;

// 获得pending的中断信息
IrqStatus = XAxiDma_BdRingGetIrq(TxRingPtr);
// 设定中断信息到ring
XAxiDma_BdRingAckIrq(TxRingPtr, IrqStatus);

// 如果不是DMA中断，就返回
if (!(IrqStatus & XAXIDMA_IRQ_ALL_MASK)) {

return;
}
// 错误中断，reset dma
if ((IrqStatus & XAXIDMA_IRQ_ERROR_MASK)) {
XAxiDma_BdRingDumpRegs(TxRingPtr);
Error = 1;
XAxiDma_Reset(&AxiDma);
TimeOut = RESET_TIMEOUT_COUNTER;
while (TimeOut) {
if (XAxiDma_ResetIsDone(&AxiDma)) {
break;
}
TimeOut -= 1;
}
return;
}

// packet传输完成的中断，调用TxCallback
if ((IrqStatus & (XAXIDMA_IRQ_DELAY_MASK  XAXIDMA_IRQ_IOC_MASK))) {
TxCallBack(TxRingPtr);
}
}

// RX中断，类似TX
static void RxCallBack(XAxiDma_BdRing * RxRingPtr)
{
int BdCount;
XAxiDma_Bd *BdPtr;
XAxiDma_Bd *BdCurPtr;
u32 BdSts;
int Index;

BdCount = XAxiDma_BdRingFromHw(RxRingPtr, XAXIDMA_ALL_BDS, &BdPtr);
BdCurPtr = BdPtr;
for (Index = 0; Index < BdCount; Index++) {

BdSts = XAxiDma_BdGetSts(BdCurPtr);
if ((BdSts & XAXIDMA_BD_STS_ALL_ERR_MASK) 
    (!(BdSts & XAXIDMA_BD_STS_COMPLETE_MASK))) {
Error = 1;
break;
}
BdCurPtr = (XAxiDma_Bd *)XAxiDma_BdRingNext(RxRingPtr, BdCurPtr);
RxDone += 1;
}

}
// RX硬件中断，类似TX
static void RxIntrHandler(void *Callback)
{
XAxiDma_BdRing *RxRingPtr = (XAxiDma_BdRing *) Callback;
u32 IrqStatus;
int TimeOut;
IrqStatus = XAxiDma_BdRingGetIrq(RxRingPtr);
XAxiDma_BdRingAckIrq(RxRingPtr, IrqStatus);
if (!(IrqStatus & XAXIDMA_IRQ_ALL_MASK)) {
return;
}
if ((IrqStatus & XAXIDMA_IRQ_ERROR_MASK)) {

XAxiDma_BdRingDumpRegs(RxRingPtr);

Error = 1;
XAxiDma_Reset(&AxiDma);

TimeOut = RESET_TIMEOUT_COUNTER;

while (TimeOut) {
if(XAxiDma_ResetIsDone(&AxiDma)) {
break;
}

TimeOut -= 1;
}

return;
}
if ((IrqStatus & (XAXIDMA_IRQ_DELAY_MASK  XAXIDMA_IRQ_IOC_MASK))) {
RxCallBack(RxRingPtr);
}
}

// 初始化中断控制器
static int SetupIntrSystem(XScuGic * IntcInstancePtr,
   XAxiDma * AxiDmaPtr, u16 TxIntrId, u16 RxIntrId)
{
// 获取BD链
XAxiDma_BdRing *TxRingPtr = XAxiDma_GetTxRing(AxiDmaPtr);
XAxiDma_BdRing *RxRingPtr = XAxiDma_GetRxRing(AxiDmaPtr);
int Status;
// 初始化中断控制器（XScuGic）
XScuGic_Config *IntcConfig;
IntcConfig = XScuGic_LookupConfig(XPAR_SCUGIC_SINGLE_DEVICE_ID);
if (NULL == IntcConfig) {
return XST_FAILURE;
}

Status = XScuGic_CfgInitialize(IntcInstancePtr, IntcConfig,
IntcConfig->CpuBaseAddress);
if (Status != XST_SUCCESS) {
return XST_FAILURE;
}

// 设置中断优先级
XScuGic_SetPriorityTriggerType(IntcInstancePtr, TxIntrId, 0xA0, 0x3);
XScuGic_SetPriorityTriggerType(IntcInstancePtr, RxIntrId, 0xA0, 0x3);

// 将TX中断源ID与TX的Handler建立关系，每次回调时传入参数TxRingPtr
Status = XScuGic_Connect(IntcInstancePtr, TxIntrId,
(Xil_InterruptHandler)TxIntrHandler,
TxRingPtr);
if (Status != XST_SUCCESS) {
return Status;
}
// RX中断注册
Status = XScuGic_Connect(IntcInstancePtr, RxIntrId,
(Xil_InterruptHandler)RxIntrHandler,
RxRingPtr);
if (Status != XST_SUCCESS) {
return Status;
}
// 使能中断
XScuGic_Enable(IntcInstancePtr, TxIntrId);
XScuGic_Enable(IntcInstancePtr, RxIntrId);

// 异常中断处理
Xil_ExceptionInit();
Xil_ExceptionRegisterHandler(XIL_EXCEPTION_ID_INT,
(Xil_ExceptionHandler)XScuGic_InterruptHandler,
(void *)IntcInstancePtr);

Xil_ExceptionEnable();

return XST_SUCCESS;
}

// 禁止中断
static void DisableIntrSystem(XScuGic * IntcInstancePtr,
u16 TxIntrId, u16 RxIntrId)
{

XScuGic_Disconnect(IntcInstancePtr, TxIntrId);
XScuGic_Disconnect(IntcInstancePtr, RxIntrId);

}
// 设定接受数据的BD
static int RxSetup(XAxiDma * AxiDmaInstPtr)
{
XAxiDma_BdRing *RxRingPtr;
int Status;
XAxiDma_Bd BdTemplate;
XAxiDma_Bd *BdPtr;
XAxiDma_Bd *BdCurPtr;
int BdCount;
int FreeBdCount;
UINTPTR RxBufferPtr;
int Index;

// 获得RX BD链指针
RxRingPtr = XAxiDma_GetRxRing(&AxiDma);

// 设定BDRing之前先关闭中断
XAxiDma_BdRingIntDisable(RxRingPtr, XAXIDMA_IRQ_ALL_MASK);

// 计算在RX_BD_SPACE_HIGH - RX_BD_SPACE_BASE + 1区域内能分配多少个BD空间
BdCount = XAxiDma_BdRingCntCalc(XAXIDMA_BD_MINIMUM_ALIGNMENT,
RX_BD_SPACE_HIGH - RX_BD_SPACE_BASE + 1);
// 创建BDRing循环链表
Status = XAxiDma_BdRingCreate(RxRingPtr, RX_BD_SPACE_BASE,
RX_BD_SPACE_BASE,
XAXIDMA_BD_MINIMUM_ALIGNMENT, BdCount);
if (Status != XST_SUCCESS) {
xil_printf("Rx bd create failed with %d\r\n", Status);
return XST_FAILURE;
}

// 初始化所有BD，用了Clone会赋值给所有BD，这里全部置空
XAxiDma_BdClear(&BdTemplate);
Status = XAxiDma_BdRingClone(RxRingPtr, &BdTemplate);
if (Status != XST_SUCCESS) {
xil_printf("Rx bd clone failed with %d\r\n", Status);
return XST_FAILURE;
}

// 获取剩余可用的BD数量
FreeBdCount = XAxiDma_BdRingGetFreeCnt(RxRingPtr);
// 分配一组BD
Status = XAxiDma_BdRingAlloc(RxRingPtr, FreeBdCount, &BdPtr);
if (Status != XST_SUCCESS) {
xil_printf("Rx bd alloc failed with %d\r\n", Status);
return XST_FAILURE;
}

BdCurPtr = BdPtr;
RxBufferPtr = RX_BUFFER_BASE;

for (Index = 0; Index < FreeBdCount; Index++) {
// 构建BD，设定每个TX BD的传输地址
Status = XAxiDma_BdSetBufAddr(BdCurPtr, RxBufferPtr);
if (Status != XST_SUCCESS) {
xil_printf("Rx set buffer addr %x on BD %x failed %d\r\n",
(unsigned int)RxBufferPtr,
(UINTPTR)BdCurPtr, Status);

return XST_FAILURE;
}
// 构建BD，设定每个TX BD的传输长度
Status = XAxiDma_BdSetLength(BdCurPtr, MAX_PKT_LEN,
RxRingPtr->MaxTransferLen);
if (Status != XST_SUCCESS) {
xil_printf("Rx set length %d on BD %x failed %d\r\n",
    MAX_PKT_LEN, (UINTPTR)BdCurPtr, Status);

return XST_FAILURE;
}

// 在这里不用设置Ctrl，因为会RX的S2MM会自动加上SOF和EOF
XAxiDma_BdSetCtrl(BdCurPtr, 0);
// 不用关心，用于上层应用识别
XAxiDma_BdSetId(BdCurPtr, RxBufferPtr);

RxBufferPtr += MAX_PKT_LEN;
BdCurPtr = (XAxiDma_Bd *)XAxiDma_BdRingNext(RxRingPtr, BdCurPtr);
}

// 设置中断压缩
Status = XAxiDma_BdRingSetCoalesce(RxRingPtr, COALESCING_COUNT,
DELAY_TIMER_COUNT);
if (Status != XST_SUCCESS) {
xil_printf("Rx set coalesce failed with %d\r\n", Status);
return XST_FAILURE;
}
// 传输BD链给DMA 准备启动传输
Status = XAxiDma_BdRingToHw(RxRingPtr, FreeBdCount, BdPtr);
if (Status != XST_SUCCESS) {
xil_printf("Rx ToHw failed with %d\r\n", Status);
return XST_FAILURE;
}

// 使能中断
XAxiDma_BdRingIntEnable(RxRingPtr, XAXIDMA_IRQ_ALL_MASK);

// 开始传输
Status = XAxiDma_BdRingStart(RxRingPtr);
if (Status != XST_SUCCESS) {
xil_printf("Rx start BD ring failed with %d\r\n", Status);
return XST_FAILURE;
}

return XST_SUCCESS;
}

// 类似RX部分
static int TxSetup(XAxiDma * AxiDmaInstPtr)
{
XAxiDma_BdRing *TxRingPtr = XAxiDma_GetTxRing(&AxiDma);
XAxiDma_Bd BdTemplate;
int Status;
u32 BdCount;

XAxiDma_BdRingIntDisable(TxRingPtr, XAXIDMA_IRQ_ALL_MASK);

BdCount = XAxiDma_BdRingCntCalc(XAXIDMA_BD_MINIMUM_ALIGNMENT,
(UINTPTR)TX_BD_SPACE_HIGH - (UINTPTR)TX_BD_SPACE_BASE + 1);

Status = XAxiDma_BdRingCreate(TxRingPtr, TX_BD_SPACE_BASE,
     TX_BD_SPACE_BASE,
     XAXIDMA_BD_MINIMUM_ALIGNMENT, BdCount);
if (Status != XST_SUCCESS) {

xil_printf("Failed create BD ring\r\n");
return XST_FAILURE;
}

XAxiDma_BdClear(&BdTemplate);
Status = XAxiDma_BdRingClone(TxRingPtr, &BdTemplate);
if (Status != XST_SUCCESS) {

xil_printf("Failed clone BDs\r\n");
return XST_FAILURE;
}

Status = XAxiDma_BdRingSetCoalesce(TxRingPtr, COALESCING_COUNT,
DELAY_TIMER_COUNT);
if (Status != XST_SUCCESS) {

xil_printf("Failed set coalescing"
" %d/%d\r\n",COALESCING_COUNT, DELAY_TIMER_COUNT);
return XST_FAILURE;
}

XAxiDma_BdRingIntEnable(TxRingPtr, XAXIDMA_IRQ_ALL_MASK);

Status = XAxiDma_BdRingStart(TxRingPtr);
if (Status != XST_SUCCESS) {

xil_printf("Failed bd start\r\n");
return XST_FAILURE;
}

return XST_SUCCESS;
}


// 传输函数
static int SendPacket(XAxiDma * AxiDmaInstPtr)
{
XAxiDma_BdRing *TxRingPtr = XAxiDma_GetTxRing(AxiDmaInstPtr);
u8 *TxPacket;
u8 Value;
XAxiDma_Bd *BdPtr, *BdCurPtr;
int Status;
int Index, Pkts;
UINTPTR BufferAddr;

// 单个Ring传输总大小不能超
if (MAX_PKT_LEN * NUMBER_OF_BDS_PER_PKT >
TxRingPtr->MaxTransferLen) {

xil_printf("Invalid total per packet transfer length for the "
    "packet %d/%d\r\n",
    MAX_PKT_LEN * NUMBER_OF_BDS_PER_PKT,
    TxRingPtr->MaxTransferLen);

return XST_INVALID_PARAM;
}

// 要发送的数据包
TxPacket = (u8 *) Packet;

Value = 0xC;
// 组装数据包
for(Index = 0; Index < MAX_PKT_LEN * NUMBER_OF_BDS_TO_TRANSFER;
Index ++) {
TxPacket[Index] = Value;

Value = (Value + 1) & 0xFF;
}
// 禁用Cache
Xil_DCacheFlushRange((UINTPTR)TxPacket, MAX_PKT_LEN *
NUMBER_OF_BDS_TO_TRANSFER);
Xil_DCacheFlushRange((UINTPTR)RX_BUFFER_BASE, MAX_PKT_LEN *
NUMBER_OF_BDS_TO_TRANSFER);

// 分配TX的BDRing
Status = XAxiDma_BdRingAlloc(TxRingPtr, NUMBER_OF_BDS_TO_TRANSFER,
&BdPtr);
if (Status != XST_SUCCESS) {

xil_printf("Failed bd alloc\r\n");
return XST_FAILURE;
}

BufferAddr = (UINTPTR)Packet;
BdCurPtr = BdPtr;

// 同一份数据传输NUMBER_OF_PKTS_TO_TRANSFER次
for(Index = 0; Index < NUMBER_OF_PKTS_TO_TRANSFER; Index++) {
// 每一个packet有NUMBER_OF_BDS_PER_PKT个描述符描述
for(Pkts = 0; Pkts < NUMBER_OF_BDS_PER_PKT; Pkts++) {
u32 CrBits = 0;
// 传输起始位置
Status = XAxiDma_BdSetBufAddr(BdCurPtr, BufferAddr);
if (Status != XST_SUCCESS) {
xil_printf("Tx set buffer addr %x on BD %x failed %d\r\n",
(unsigned int)BufferAddr,
(UINTPTR)BdCurPtr, Status);

return XST_FAILURE;
}
// 传输长度
Status = XAxiDma_BdSetLength(BdCurPtr, MAX_PKT_LEN,
TxRingPtr->MaxTransferLen);
if (Status != XST_SUCCESS) {
xil_printf("Tx set length %d on BD %x failed %d\r\n",
MAX_PKT_LEN, (UINTPTR)BdCurPtr, Status);

return XST_FAILURE;
}
// 组装TX的BD时，第一个BD要加SOF，最后一个要加EOF
if (Pkts == 0) {
CrBits = XAXIDMA_BD_CTRL_TXSOF_MASK;
}
if(Pkts == (NUMBER_OF_BDS_PER_PKT - 1)) {
CrBits = XAXIDMA_BD_CTRL_TXEOF_MASK;
}
// 设置Crtl字段和ID
XAxiDma_BdSetCtrl(BdCurPtr, CrBits);
XAxiDma_BdSetId(BdCurPtr, BufferAddr);
// 传输下一个packet
BufferAddr += MAX_PKT_LEN;
BdCurPtr = (XAxiDma_Bd *)XAxiDma_BdRingNext(TxRingPtr, BdCurPtr);
}
}

// 提交BDRing到DMA控制器
Status = XAxiDma_BdRingToHw(TxRingPtr, NUMBER_OF_BDS_TO_TRANSFER,
BdPtr);
if (Status != XST_SUCCESS) {

xil_printf("Failed to hw, length %d\r\n",
(int)XAxiDma_BdGetLength(BdPtr,
TxRingPtr->MaxTransferLen));

return XST_FAILURE;
}
return XST_SUCCESS;
}
```

在Zedboard上测试通过。