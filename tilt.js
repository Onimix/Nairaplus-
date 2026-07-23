/* NairaPlus — tilt.js
   Pointer/touch-based 3D tilt for the hero receipt card. */
(function(){
  const card = document.querySelector('.receipt');
  if(!card) return;

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(prefersReducedMotion) return;

  const wrap = card.closest('.receipt-wrap');

  function setTilt(px, py){
    // px, py range -0.5..0.5
    const rotY = px * 22 - 10;   // base -10deg matches CSS default
    const rotX = 6 - py * 16;
    card.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
  }

  function reset(){
    card.style.transform = 'rotateX(6deg) rotateY(-10deg)';
  }

  wrap.addEventListener('pointermove', function(e){
    const rect = wrap.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    setTilt(px, py);
  });
  wrap.addEventListener('pointerleave', reset);

  // Gentle device-orientation tilt on mobile, if available
  if(window.DeviceOrientationEvent){
    window.addEventListener('deviceorientation', function(e){
      if(e.beta === null || e.gamma === null) return;
      const px = Math.min(Math.max((e.gamma + 30) / 60, 0), 1);
      const py = Math.min(Math.max((e.beta - 20) / 60, 0), 1);
      setTilt(px, py);
    });
  }
})();
