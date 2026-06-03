// Theme Toggle

const toggle = document.getElementById('theme-toggle');

toggle.addEventListener('click', () => {
    document.body.classList.toggle('light-mode');

    if(document.body.classList.contains('light-mode')){
        toggle.innerHTML = '☀️';
    } else {
        toggle.innerHTML = '🌙';
    }
});

// Scroll Progress Bar

window.addEventListener('scroll', () => {

    const scrollTop =
        document.documentElement.scrollTop;

    const scrollHeight =
        document.documentElement.scrollHeight -
        document.documentElement.clientHeight;

    const progress =
        (scrollTop / scrollHeight) * 100;

    document.querySelector('.progress-bar')
        .style.width = progress + '%';
});

// Fade Animation

const observer = new IntersectionObserver(
(entries)=>{

entries.forEach(entry=>{

if(entry.isIntersecting){
entry.target.classList.add('show');
}

});

},
{
threshold:0.1
}
);

document
.querySelectorAll(
'.section,.card,.timeline-item,.contact-card'
)
.forEach(el=>{

el.classList.add('fade-up');
observer.observe(el);

});
