---
title: 解决Xilinx XRT在新版内核(>5.15)下的驱动错误
tags:
  - FPGA
  - Xilinx
id: '292'
categories:
  - - FPGA
date: 2023-07-17 12:29:44
---

## 起因

Linux内核已经升级到6.x了，而可怜的XRT还只支持到5.15。我使用Ubuntu 22.04 安装 最新版XRT 2.14.354的时候就出现了这种错误

```
Error!  Build of xocl.ko failed for: 5.19.0-46-generic (x86_64)
Make sure the name of the generated module is correct and at the root of the
build directory, or consult make.log in the build directory
/var/lib/dkms/xrt/2.14.354/build/ for more information.
****************************************************************
* DKMS failed to install XRT drivers.
* Please check if kernel development headers are installed for OS variant used.
* 
* Check build logs in /var/lib/dkms/xrt/2.14.354
****************************************************************
Installing MSD / MPD daemons
 Components                         Status        
--------------------------------------------------
 XOCL & XCLMGMT Kernel Driver  Failed. Check build log : /var/lib/dkms/xrt/2.14.354/build/make.log
 XRT USERSPACE                 Success            
 MPD/MSD                       Success            
```

看起来像是驱动构建失败了，通过观察log可以发现是因为QDMA驱动的构建出了问题：

```
/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c: In function ‘sgl_unmap’:
/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c:2305:25: error: implicit declaration of function ‘pci_unmap_page’; did you mean ‘dma_unmap_page’? [-Werror=implicit-function-declaration]
 2305                          pci_unmap_page(pdev, sg->dma_addr - sg->offset,
                               ^~~~~~~~~~~~~~
                               dma_unmap_page
/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c: In function ‘sgl_map’:
/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c:2337:32: error: implicit declaration of function ‘pci_map_page’; did you mean ‘dma_map_page’? [-Werror=implicit-function-declaration]
 2337                  sg->dma_addr = pci_map_page(pdev, sg->pg, 0, PAGE_SIZE, dir);
                                      ^~~~~~~~~~~~
                                      dma_map_page
In file included from ./include/linux/export.h:33,
                 from ./include/linux/linkage.h:7,
                 from ./include/linux/kernel.h:17,
                 from ./include/linux/interrupt.h:6,
                 from /var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.h:39,
                 from /var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c:27:
/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c:2338:30: error: implicit declaration of function ‘pci_dma_mapping_error’; did you mean ‘dma_mapping_error’? [-Werror=implicit-function-declaration]
 2338                  if (unlikely(pci_dma_mapping_error(pdev, sg->dma_addr))) {
                                    ^~~~~~~~~~~~~~~~~~~~~
./include/linux/compiler.h:78:45: note: in definition of macro ‘unlikely’
   78  # define unlikely(x)    __builtin_expect(!!(x), 0)
                                                   ^
cc1: some warnings being treated as errors
make[3]: *** [scripts/Makefile.build:257: /var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.o] Error 1
make[2]: *** [Makefile:1857: /var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf] Error 2
make[2]: Leaving directory '/usr/src/linux-headers-5.19.0-46-generic'
make[1]: *** [Makefile:135: all] Error 2
make[1]: Leaving directory '/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf'
make: *** [Makefile:2: all] Error 2
```

追溯了一下Kernel代码，发现是因为`pci_dma_*`这类函数老早就被标记过时了，之前一直是通过`include/linux/pci-dma-compat.h`苟活，[在这个PATCH](https://lore.kernel.org/all/20220310170445.GA163749@bhelgaas/T/)中被标记了删除。Xilinx既然没空打理，那我们可以自己动手解决一下。。。

## 解决方案

1、编辑`/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/libqdma_export.c` 增加如下代码

```
static inline dma_addr_t pci_map_page(struct pci_dev *hwdev, struct page *page,
             unsigned long offset, size_t size, int direction)
{
        return dma_map_page(hwdev == NULL ? NULL : &hwdev->dev, page, offset, size, (enum dma_data_direction)direction);
}

static inline void pci_unmap_page(struct pci_dev *hwdev, dma_addr_t dma_address,
               size_t size, int direction)
{
        dma_unmap_page(hwdev == NULL ? NULL : &hwdev->dev, dma_address, size, (enum dma_data_direction)direction);
}

static inline int pci_dma_mapping_error(struct pci_dev *pdev, dma_addr_t dma_addr)
{
        return dma_mapping_error(&pdev->dev, dma_addr);
}
```

2、编辑`/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/qdma_st_c2h.c` 搜索下面的宏进行替换

```
PCI_DMA_FROMDEVICE -> DMA_FROM_DEVICE
```

3、编辑/var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf/../lib/libqdma/QDMA/linux-kernel/driver/libqdma/xdev.c增加如下代码：

```
static inline int pci_set_dma_mask(struct pci_dev *dev, u64 mask)
{
        return dma_set_mask(&dev->dev, mask);
}

static inline int pci_set_consistent_dma_mask(struct pci_dev *dev, u64 mask)

{
        return dma_set_coherent_mask(&dev->dev, mask);
}
```

然后对目标进行重新build

```
sudo chown -R username:usergroup /var/lib/dkms/xrt
cd /var/lib/dkms/xrt/2.14.354/build/driver/xocl/userpf
make
cd /var/lib/dkms/xrt/2.14.354/build/driver/xocl
make
sudo make install
```

出现Skipping BTF generation...的解决方案

_keyboard\_arrow\_down_

参考https://askubuntu.com/questions/1348250/skipping-btf-generation-xxx-due-to-unavailability-of-vmlinux-on-ubuntu-21-04，如果出现Skipping BTF generation for xxx due to unavailability of vmlinux, 可以运行下列命令 sudo apt install dwarves sudo cp /sys/kernel/btf/vmlinux /usr/lib/modules/\`uname -r\`/build/ 然后再进行上述编译

## 结果

按照上述修改后可以重新构建所需的驱动模块，识别Xilinx的加速卡

![](https://lgyserver.top/wp-content/uploads/2023/07/image-1024x524.png)

平台烧写也正常。

## 后记

鼓捣了半天才发现最近刚有人给Xilinx提了PR。。也可以用这里的修补方式救一救，大同小异。

[https://github.com/Xilinx/dma\_ip\_drivers/pull/216/files](https://github.com/Xilinx/dma_ip_drivers/pull/216/files)

这真是。。泰酷辣！Xilinx搞快点儿！