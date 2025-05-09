var code = `
<script>
setTimeout(()=>{
    let gis = document.getElementsByClassName("group-image-wrap");
    for (let i = 0; i < gis.length; i++) {
        let gi = gis[i];
        let img = gi.getElementsByTagName("img")[0];
        if (img.parentElement && img.parentElement.href) {
            img.parentElement.href = img.parentElement.href.replace("https://www.lgyserver.top/", "");
            img.parentElement.href = img.parentElement.href.replace("https://lgyserver.top/", "");
        }
        if (img && img.src) {
            img.src = img.src.replace("https://www.lgyserver.top/", "");
            img.src = img.src.replace("https://lgyserver.top/", "");
        }
    }
}, 1000);
</script>`;

hexo.extend.injector.register('body_end', code, 'post');