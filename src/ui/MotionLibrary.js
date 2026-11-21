import * as THREE from 'three';
import { HERO_PRESETS } from '../config/constants.js';
import { motionNames } from '../systems/Motion.js';

const mixamoSearch = (name, pack) => 'https://www.mixamo.com/#/?page=1&type=' +
  (pack ? 'MotionPack' : 'Motion%2CMotionPack') + '&query=' + encodeURIComponent(name);
const genreNames = { Combat: '战斗', Adventure: '冒险', Sport: '运动', Dance: '舞蹈', Fantasy: '奇幻',
  Superhero: '超级英雄', 'Skinning Test': '蒙皮测试' };
const searchTerms = {
  蹲走: /crouch.*walk|walk.*crouch/i, 蹲行: /crouch.*walk|walk.*crouch/i,
  蹲下: /crouch/i, 转身: /turn|pivot/i, 左转: /left.*turn|turn.*left/i, 右转: /right.*turn|turn.*right/i,
  走路: /walk/i, 奔跑: /run|jog/i, 爬行: /crawl/i, 受击: /hit|reaction|impact/i,
  投降: /surrender|hands up/i, 倒地: /fall|dying|death/i, 待机: /idle/i, 移动: /locomotion/i
};

export class MotionLibrary {
  constructor(assets, factory, renderer, disposePerson, restoreSize) {
    Object.assign(this, { assets, factory, renderer, disposePerson, restoreSize });
    this.dialog = document.createElement('dialog');
    this.dialog.id = 'motion-library';
    this.dialog.setAttribute('aria-labelledby', 'motion-title');
    this.dialog.innerHTML = '<header><h2 id="motion-title">动作库</h2><button type="button" data-close>返回游戏</button></header>' +
      '<div class="motion-layout"><section class="motion-browser"><label>查看<select data-mode>' +
      '<option value="local">已装入游戏</option><option value="packs">官网动作包</option><option value="catalog">官网目录</option></select></label>' +
      '<label>搜索<input type="search" data-filter placeholder="如 蹲走、Crouch" autocomplete="off"></label>' +
      '<select size="9" data-list aria-label="动作列表"></select><small data-count aria-live="polite"></small></section>' +
      '<section class="motion-detail"><div data-stage class="motion-stage"></div>' +
      '<div data-online hidden><img data-picture alt="" referrerpolicy="no-referrer">' +
      '<small data-image-error hidden>预览暂时无法载入，可在 Mixamo 查看。</small>' +
      '<label data-versions hidden>同名版本<select data-variant></select></label></div><div class="motion-tools" data-tools>' +
      '<label>试演角色<select data-rig></select></label><button data-replay type="button">重播</button></div>' +
      '<strong data-title></strong><span data-note role="status"></span><a data-source target="_blank" rel="noopener noreferrer" hidden>在 Mixamo 查看</a>' +
      '</section></div>';
    document.body.append(this.dialog);
    const el = name => this.dialog.querySelector('[data-' + name + ']');
    for (const name of ['mode', 'filter', 'list', 'count', 'stage', 'online', 'picture', 'versions', 'variant', 'tools', 'rig', 'title', 'note', 'source']) this[name] = el(name);
    this.imageError = el('image-error');
    this.picture.onerror = () => { if (this.picture.hasAttribute('src')) this.imageError.hidden = false; };
    this.picture.onload = () => { this.imageError.hidden = true; };
    this.variant.onchange = () => this.showOfficialPreview();
    for (const p of HERO_PRESETS) this.rig.add(new Option(p.name, p.id));
    this.rig.add(new Option('士兵', 'soldier'));
    this.mode.onchange = () => this.showList();
    this.filter.oninput = () => this.showList();
    this.list.onchange = () => this.select();
    this.rig.onchange = () => this.select();
    el('replay').onclick = () => this.action?.reset().play();
    el('close').onclick = () => this.dialog.close();
    this.dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.dialog.close();
      }
    });
    this.dialog.addEventListener('close', () => this.release());
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 35);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x19232b);
    this.scene.add(new THREE.HemisphereLight(0xfff2df, 0x78899f, 2.1));
    const key = new THREE.DirectionalLight(0xffe4bb, 2.6);
    key.position.set(3, 5, -2);
    const rim = new THREE.DirectionalLight(0xbfddff, 2.0);
    rim.position.set(-3, 3, 2);
    const floor = new THREE.GridHelper(16, 40, 0x6b716e, 0x35414a);
    this.scene.add(key, rim, floor);
    this.revision = 0;
  }

  open(preset) {
    if (this.dialog.open) return;
    this.rig.value = preset;
    this.width = this.height = 0;
    this.mode.value = 'local';
    this.filter.value = '';
    this.dialog.showModal();
    const canvas = this.renderer.domElement;
    this.anchor = document.createComment('game canvas');
    canvas.before(this.anchor);
    this.stage.append(canvas);
    this.showList();
  }

  clearPerson() {
    if (!this.person) return;
    const mixer = this.person.userData.mixer;
    mixer.stopAllAction();
    mixer.uncacheRoot(mixer.getRoot());
    this.scene.remove(this.person);
    this.disposePerson(this.person);
    this.person = this.action = null;
  }

  release() {
    this.revision++;
    this.picture.removeAttribute('src');
    this.clearPerson();
    this.anchor?.replaceWith(this.renderer.domElement);
    this.anchor = null;
    this.restoreSize();
  }

  async showList() {
    const revision = ++this.revision;
    const local = this.mode.value === 'local';
    this.stage.hidden = this.tools.hidden = !local;
    let items;
    if (local) {
      items = Object.entries(this.assets.mixamoAnims).map(([key, m]) => {
        const name = m.label || m.src?.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || key;
        let role = motionNames[m.family || key] || '';
        if (m.stance === 'crouch') role = role.replace('原地', '蹲姿');
        return { key, name, caption: role ? role + ' · ' + name : name };
      });
    } else {
      this.count.textContent = '正在读取官网目录…';
      try {
        this.catalog ??= fetch('assets/chars/mixamo-catalog.json').then(async r => {
          if (!r.ok) throw new Error();
          const catalog = await r.json();
          this.previewBase = catalog.previewBase;
          return catalog.items;
        });
        items = await this.catalog;
      } catch {
        if (revision !== this.revision) return;
        this.catalog = null;
        this.list.replaceChildren();
        this.title.textContent = '';
        this.note.textContent = '';
        this.online.hidden = true;
        this.picture.removeAttribute('src');
        this.count.textContent = '官网目录载入失败';
        this.source.href = mixamoSearch('', false);
        this.source.hidden = false;
        return;
      }
      if (revision !== this.revision) return;
      if (this.mode.value === 'packs') items = items.filter(item => item.pack);
    }
    const query = this.filter.value.trim().toLowerCase();
    const term = Object.hasOwn(searchTerms, query) ? searchTerms[query] : null;
    this.rows = items.filter(item => (item.caption || item.name).toLowerCase().includes(query) || term?.test(item.name) ||
      item.genres?.some(g => g.toLowerCase().includes(query) || genreNames[g]?.includes(query)));
    const previous = this.list.value;
    this.list.replaceChildren(...this.rows.map(item => new Option(item.caption || item.name, item.key || item.name)));
    const found = this.rows.findIndex(item => (item.key || item.name) === previous);
    this.list.selectedIndex = found >= 0 ? found : this.rows.length ? 0 : -1;
    const entries = this.rows.reduce((sum, row) => sum + (row.variants || 1), 0);
    this.count.textContent = local ? this.rows.length + ' 个已安装动作' : entries + ' 个官网条目' +
      (entries !== this.rows.length ? ' · ' + this.rows.length + ' 个名称' : '');
    this.select();
  }

  async select() {
    const revision = ++this.revision;
    const row = this.rows[this.list.selectedIndex];
    const local = this.mode.value === 'local';
    this.title.textContent = row?.name || '';
    this.note.textContent = row ? '' : '没有匹配的动作';
    this.source.hidden = local || !row;
    this.online.hidden = local || !row;
    if (this.online.hidden) this.picture.removeAttribute('src');
    if (this.action) {
      this.action.stop();
      this.person.userData.mixer.uncacheAction(this.action.getClip());
    }
    this.action = null;
    if (this.person) this.person.visible = false;
    if (!row) return;
    if (!local) {
      this.note.textContent = row.pack ? '动作包 · ' + row.pack + ' 个动作' :
        [row.variants > 1 ? row.variants + ' 个同名动作' : '单个动作', ...(row.genres || []).map(g => genreNames[g] || g)].join(' · ');
      this.source.href = mixamoSearch(row.name, !!row.pack);
      this.versions.hidden = row.previews.length < 2;
      this.variant.replaceChildren(...row.previews.map((_, i) => new Option('版本 ' + (i + 1), String(i))));
      this.showOfficialPreview();
      return;
    }
    this.note.textContent = '正在载入动作…';
    try {
      const clips = await this.assets.loadMotion(row.key);
      if (revision !== this.revision || !this.dialog.open) return;
      if (!this.person || this.preset !== this.rig.value) {
        this.clearPerson();
        this.preset = this.rig.value;
        if (this.preset !== 'soldier') {
          await this.assets.ensureHeroPreset(this.preset);
          if (revision !== this.revision || !this.dialog.open) return;
        }
        this.person = this.factory.createPerson(this.preset === 'soldier' ? 'soldier' : 'hero', undefined, this.preset);
        this.person.userData.gun.visible = false;
        this.person.userData.mixer.stopAllAction();
        this.scene.add(this.person);
      }
      const u = this.person.userData;
      const clip = this.preset === 'soldier' ? clips.soldier : clips.man;
      const meta = this.assets.mixamoAnims[row.key];
      this.action = u.mixer.clipAction(clip).reset();
      this.action.setLoop(meta.loop ? THREE.LoopRepeat : THREE.LoopOnce, meta.loop ? Infinity : 1);
      this.action.clampWhenFinished = true;
      this.action.play();
      u.mixer.update(0);
      this.person.visible = true;
      const synthTag = meta.synthetic ? (meta.src?.includes('镜像') ? ' · 镜像动作' : ' · 合成占位') : '';
      this.note.textContent = clip.duration.toFixed(2) + ' 秒 · ' + (meta.loop ? '循环' : '单次') + synthTag;
    } catch {
      if (revision === this.revision) this.note.textContent = '动作载入失败，可重新选择后再试';
    }
  }

  showOfficialPreview() {
    const row = this.rows[this.list.selectedIndex];
    const file = row?.previews?.[this.variant.selectedIndex];
    if (!file) return;
    this.imageError.hidden = true;
    this.picture.alt = row.name + ' · Mixamo 官网预览';
    this.picture.src = new URL(file, this.previewBase).href;
  }

  render(dt) {
    if (this.stage.hidden) return;
    const w = this.stage.clientWidth, h = this.stage.clientHeight;
    if (!w || !h) return;
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h, false);
    }
    this.camera.aspect = w / h;
    const distance = Math.max(3.7, 3.6 / this.camera.aspect);
    this.camera.position.set(distance * 0.76, 1.26, distance * 0.65);
    this.camera.lookAt(0, 0.88, 0);
    this.camera.updateProjectionMatrix();
    if (this.action) {
      this.person.userData.mixer.update(dt);
      const yaw = this.action.getClip().userData.turnYaw;
      const frame = this.action.time * 30;
      const i = Math.floor(frame);
      this.person.rotation.y = yaw ? THREE.MathUtils.lerp(yaw[Math.min(i, yaw.length - 1)], yaw[Math.min(i + 1, yaw.length - 1)], frame - i) : 0;
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
