var code = `
let gis = document.getElementsByClassName("group-image-wrap");
for (let i = 0; i < gis.length; i++) {
    let gi = gis[i];
    let img = gi.getElementsByTagName("img")[0];
    if (img) {
        console.log("fix group image url", img.parentElement.href, img.src);
        img.parentElement.href = img.parentElement.href.replace("https://www.lgyserver.top/", "");
        img.src = img.src.replace("https://www.lgyserver.top/", "");
    }
}`;

hexo.extend.injector.register('body_end', code, 'post');