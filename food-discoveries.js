// Offline map and user-provided photos. No external network or libraries.
  (function () {
    'use strict';
    const places = {
      ken: { dish: 'チキンレッグカレー', restaurant: '欧風カレーKEN',
        address: '北海道札幌市東区北15条東1丁目2-17 イースタンビル 1F', visited: '2024-02-06', comment: 'チキンの塩気がちょうどよい。身がホロホロで、スプーンで簡単に崩せる。ピリ辛のルーがよく合っておいしい。札幌に来るたびに立ち寄りたい。', photo: 'photo-ken', x: 892.65, y: 123.30 },
      maruyama: { dish: '浜カレー', restaurant: '円山教授。円山本店',
        address: '〒064-0804 北海道札幌市中央区南4条西21丁目1-27 第五藤栄ビル',
        visited: '2024-01-06', comment: '魚介のソテーがたくさんでうれしい。エビの出汁のカレーがとてもおいしい。',
        photo: 'photo-maruyama', x: 892.55, y: 123.25 },
      hamabe: { dish: 'フグのから揚げ', restaurant: '浜べゑ 新山口北口店',
        address: '山口県山口市小郡明治2-7-15 河村ビル 1F',
        visited: '2023-11-30', comment: 'フグはから揚げがうまい。',
        photo: 'photo-hamabe', x: 864.99, y: 149.72 },
      hamilton: { dish: 'Jumbo Lump Crab Cake', restaurant: 'The Hamilton',
        address: '600 14th St NW, Washington, DC 20005, USA', visited: '2026-09-19', comment: '—', x: 286.02, y: 135.60 },
      boulted: { dish: 'Country Ham & Cheese Croissant', restaurant: 'Boulted Bread',
        address: '328 Dupont Cir, Raleigh, NC 27603, USA', visited: '2026-10-11', comment: 'ハムとチーズの塩気と、バターの風味が合っている。外側の層はサクサクで、内側はふわっとしっとり。とてもおいしい。', photo: 'photo-boulted', x: 281.53, y: 144.77 },
      empire: { dish: 'Roasted Pennsylvania Five Spice Duck Breast', restaurant: 'Second Empire Restaurant and Tavern',
        address: '330 Hillsborough St, Raleigh, NC 27603, USA', visited: '2026-10-10', comment: '付け合わせのブロッコリーを固めたやつがおいしい。ソースは時期により変わるようで、今回はかぼちゃのソースだった。', photo: 'photo-duck',
        secondDish: 'Empire Chocolate Souffle', secondPhoto: 'photo-souffle',
        secondComment: '注文してから焼いてくれて、焼き立てにミルクソースをかけて食べるのがおいしい。サクサクで、ほんのり甘い。', x: 281.52, y: 144.76 },
      saltwater: { dish: 'She Crab Soup', restaurant: 'Saltwater Grill at River Bend',
        address: '1 Marina Rd, New Bern, NC 28562, USA', visited: '2026-09-07', comment: 'クリームスープはトロッとしていてカニの風味と塩気がちょうどよい。カニの身もたくさん乗っている。再訪して食べたい。', photo: 'photo-saltwater', x: 286.02, y: 146.65 }
    };
    const map = document.getElementById('world-map');
    const markers = Array.from(document.querySelectorAll('.pin'));
    const sapporoCluster = document.getElementById('sapporo-cluster');
    const sapporoLabel = document.getElementById('sapporo-label');
    const sapporoPicker = document.getElementById('sapporo-picker');
    const eastCluster = document.getElementById('us-cluster');
    const raleighCluster = document.getElementById('raleigh-cluster');
    const picker = document.getElementById('raleigh-picker');
    const width = 1000, height = 500;
    let view = { x: 0, y: 0, w: width, h: height };
    let drag = null;
    let selected = 'ken';

    function closePickers() {
      picker.hidden = true;
      sapporoPicker.hidden = true;
    }

    function scaleCluster(element, centerX, centerY, zoom, radius) {
      element.querySelector('circle').setAttribute('r', radius * zoom);
      const label = element.querySelector('text');
      label.setAttribute('font-size', 14 * zoom);
      label.setAttribute('y', centerY + 5 * zoom);
    }

    function setView(x, y, w) {
      w = Math.max(width / 10, Math.min(width, w));
      const h = w / 2;
      view = { x: Math.max(0, Math.min(width - w, x)),
               y: Math.max(0, Math.min(height - h, y)), w, h };
      map.setAttribute('viewBox', [view.x, view.y, view.w, view.h].join(' '));
      const zoom = view.w / width;
      const overview = view.w > 400;
      eastCluster.style.display = overview ? '' : 'none';
      raleighCluster.style.display = overview ? 'none' : '';
      sapporoCluster.style.display = '';
      markers.forEach(function (marker) {
        marker.style.display = overview && marker.dataset.region === 'us' ? 'none' : '';
        const point = marker.querySelector('circle');
        const label = marker.querySelector('text');
        const px = Number(point.getAttribute('cx'));
        const py = Number(point.getAttribute('cy'));
        point.setAttribute('r', (marker.classList.contains('active') ? 12 : 9) * zoom);
        label.setAttribute('font-size', 14 * zoom);
        label.setAttribute('x', px + (marker.dataset.side === 'left' ? -17 : 17) * zoom);
        label.setAttribute('y', py + 5 * zoom);
        label.style.strokeWidth = (3 * zoom) + 'px';
      });
      scaleCluster(sapporoCluster, 892.55, 123.25, zoom, 14);
      sapporoLabel.setAttribute('font-size', 14 * zoom);
      sapporoLabel.setAttribute('x', 892.55 - 18 * zoom);
      sapporoLabel.setAttribute('y', 123.25 + 5 * zoom);
      scaleCluster(eastCluster, 283.78, 140.18, zoom, 14);
      scaleCluster(raleighCluster, 281.53, 144.77, zoom, 14);
    }

    function putPhoto(elementId, templateId) {
      const el = document.getElementById(elementId);
      if (!templateId) {
        el.hidden = true;
        el.removeAttribute('src');
        el.alt = '';
        return;
      }
      const tmpl = document.getElementById(templateId);
      const img = tmpl.content.querySelector('img');
      el.src = img.getAttribute('src');
      el.alt = img.alt;
      el.hidden = false;
    }

    function choose(id) {
      const place = places[id];
      if (!place) return;
      selected = id;
      for (const field of ['dish', 'restaurant', 'address', 'visited', 'comment']) {
        document.getElementById(field).textContent = place[field];
      }
      putPhoto('dish-photo', place.photo);
      const extraLabel = document.getElementById('second-dish');
      extraLabel.hidden = !place.secondDish;
      extraLabel.textContent = place.secondDish || '';
      putPhoto('second-photo', place.secondPhoto);
      const secondCommentBlock = document.getElementById('second-comment-block');
      secondCommentBlock.hidden = !place.secondComment;
      document.getElementById('second-comment').textContent = place.secondComment || '';
      markers.forEach(function (marker) {
        marker.classList.toggle('active', marker.dataset.place === id);
      });
      closePickers();
      // US locations are grouped on the world map; keep Raleigh and DC selectable.
      const w = (id === 'ken' || id === 'maruyama') ? width / 4 : width / 7;
      setView(place.x - w / 2, place.y - w / 4, w);
    }

    markers.forEach(function (marker) {
      marker.addEventListener('click', function (event) {
        event.stopPropagation();
        choose(marker.dataset.place);
      });
      marker.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose(marker.dataset.place);
        }
      });
    });
    function zoomToEastUS() {
      closePickers();
      const w = width / 7;
      setView(283.78 - w / 2, 140.18 - w / 4, w);
    }
    function openRaleigh() {
      sapporoPicker.hidden = true;
      picker.hidden = !picker.hidden;
    }
    function openSapporo() {
      picker.hidden = true;
      sapporoPicker.hidden = !sapporoPicker.hidden;
    }
    eastCluster.addEventListener('click', function (event) { event.stopPropagation(); zoomToEastUS(); });
    raleighCluster.addEventListener('click', function (event) { event.stopPropagation(); openRaleigh(); });
    sapporoCluster.addEventListener('click', function (event) { event.stopPropagation(); openSapporo(); });
    for (const item of [eastCluster, raleighCluster, sapporoCluster]) {
      item.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (item === eastCluster) zoomToEastUS();
          else if (item === sapporoCluster) openSapporo();
          else openRaleigh();
        }
      });
    }
    document.querySelectorAll('.place-picker button[data-pick]').forEach(function (button) {
      button.addEventListener('click', function () { choose(button.dataset.pick); });
    });
    map.addEventListener('wheel', function (event) {
      event.preventDefault();
      closePickers();
      const bounds = map.getBoundingClientRect();
      const centerX = view.x + (event.clientX - bounds.left) / bounds.width * view.w;
      const centerY = view.y + (event.clientY - bounds.top) / bounds.height * view.h;
      const w = Math.max(width / 10, Math.min(width, view.w * (event.deltaY < 0 ? 0.78 : 1.28)));
      setView(centerX - (centerX - view.x) * w / view.w,
              centerY - (centerY - view.y) * w / view.w, w);
    }, { passive: false });
    map.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.pin, .cluster')) return;
      closePickers();
      drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, view: { ...view } };
      map.setPointerCapture(event.pointerId);
      map.classList.add('dragging');
    });
    map.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.pointer) return;
      const rect = map.getBoundingClientRect();
      setView(drag.view.x - (event.clientX - drag.x) / rect.width * drag.view.w,
              drag.view.y - (event.clientY - drag.y) / rect.height * drag.view.h,
              drag.view.w);
    });
    function endDrag() { drag = null; map.classList.remove('dragging'); }
    map.addEventListener('pointerup', endDrag);
    map.addEventListener('pointercancel', endDrag);
    document.getElementById('reset-map').addEventListener('click', function () {
      closePickers();
      setView(0, 0, width);
    });
    choose(selected);
    setView(0, 0, width);
  }());
