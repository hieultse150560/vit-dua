(function (root) {
  'use strict';
  // Vietnamese play-by-play for twists. Pure and deterministic: the same event
  // always gets the same line. {a} = the event's actor, {b} = its target.
  const LINES = {
    'wings:fly': ['{a} dang cánh bay vút lên! Không ai cản nổi!', 'Cánh vàng! {a} bay qua đầu cả đám!', 'Vịt biết bay! {a} cất cánh ngoạn mục!'],
    'torpedo:hit': ['Ối giời ơi! {a} phóng thủy lôi, {b} lật thuyền rồi!', 'BÙM! {b} úp mặt xuống sông, quà của {a} đấy!', '{a} nhắm thẳng {b}, trúng phóc! Lật nhào!'],
    'wave:hit': ['Sóng thần! {a} cuốn phăng cả tốp đầu!', '{a} gọi sóng, mấy con dẫn đầu dạt hết về sau!', 'Một con sóng khổng lồ từ {a}! Cục diện đảo lộn!'],
    'wave:reflected': ['{a} đánh sóng trúng gương, sóng dội ngược lại chính mình!'],
    'swap:swapped': ['ĐỔI ĐỜI! {a} và {b} đổi chỗ trong chớp mắt!', '{a} hoán đổi với {b}! Ai ngờ được!', 'Một cú tráo đổi thần sầu giữa {a} và {b}!'],
    'rocket:boost': ['{a} châm tên lửa, phóng như bay!', 'Tên lửa rực lửa! {a} xé nước lao lên!'],
    'rocket:exploded': ['Ôi không! Tên lửa của {a} nổ tung, tự lật luôn!', '{a} châm ngòi… và nổ máy! Thảm họa!'],
    'mirror:reflected': ['Gương thần! {a} dội ngược đòn về phía {b}!', 'Phản đòn! {b} tự lãnh hậu quả trước gương của {a}!', '{a} giơ gương lên, {b} ăn trọn đòn của chính mình!'],
    'mirror:fallback': ['{a} chiếu gương thẳng mặt {b}, chói hết cả mắt!', 'Ánh gương của {a} làm {b} lóa mắt chậm hẳn lại!'],
    'hook:hit': ['{a} quăng câu, kéo tuột {b} về sau rồi vượt lên!', 'Móc câu! {b} bị {a} lôi ngược lại!'],
    'hook:fallback': ['{a} móc vào bờ, tự kéo mình lên phía trước!'],
    'tornado:shuffled': ['Lốc xoáy của {a} xáo tung đường đua!', 'Gió lốc nổi lên! {a} khiến mọi thứ đảo điên!'],
    'tornado:none': ['{a} gọi lốc xoáy nhưng ai cũng có phao, gió thổi qua vô hại!'],
    'banana:dropped': ['{a} thả vỏ chuối ngay trước mũi {b}!', 'Cẩn thận {b}! {a} vừa rải vỏ chuối!'],
    'banana:hit': ['{b} đạp trúng vỏ chuối của {a}, quay như chong chóng!', 'Trượt rồi! {b} xoay tít vì vỏ chuối của {a}!'],
    'buoy:blocked': ['Phao thần của {a} chặn đứng đòn của {b} rồi bật lên!', '{a} đỡ gọn đòn của {b}! Phao quá đỉnh!', 'Phao thần cứu {a} một bàn thua trông thấy, còn bật lên nữa!'],
    'buoy:fallback': ['Phao của {a} bơm căng, đẩy vọt lên phía trước!'],
    'rock:hit': ['Ôi! {a} vấp đá, ngã lăn quay!', 'Hòn đá oan nghiệt! {a} vấp ngã ngay lúc đang dẫn!', '{a} đang dẫn đầu thì… vấp đá! Kịch tính quá!'],
    'croc:hit': ['Cá sấu! {a} bị đớp kéo lùi lại!', 'Một con cá sấu ngoạm lấy {a}! Hú hồn!'],
    'wind:boost': ['Gió thuận thổi bay {a} lên phía trước!', 'Ông trời thương {a}, gió đẩy lên vùn vụt!'],
    'whirlpool:hit': ['Xoáy nước cuốn {a} quay vòng vòng!', '{a} lọt vào xoáy nước, chóng hết cả mặt!'],
    'dolphin:boost': ['Cá heo xuất hiện, cõng {a} lên phía trước!', '{a} được cá heo cho đi nhờ! Vui quá!'],
    blocked: ['{b} có lá chắn, đòn của {a} tan biến!', 'Đỡ được rồi! {a} vô vọng trước {b}!', 'Phao cứu {a} một bàn thua trông thấy!'],
    reflected: ['Đòn của {a} bị gương của {b} dội ngược!', '{a} tấn công {b} và… tự hại mình!'],
    immune: ['{b} đang miễn nhiễm, {a} đánh hụt!', '{a} ra đòn nhưng không ăn thua!', '{a} vẫn còn choáng nên không sao!'],
    default: ['{a} tung chiêu vào {b}!', '{a} ra tay!']
  };
  const OPENERS = ['Các tay bơi đã vào vị trí, trận đấu bắt đầu!', 'Xuất phát! Hãy xem ai sẽ lật kèo hôm nay!'];
  const WEATHER = {
    sunny: 'Trời nắng đẹp, mặt sông phẳng lặng, nhưng đừng tin vào điều đó!',
    rain: 'Mưa rào trên sông, coi chừng xoáy nước và cá sấu!',
    wind: 'Gió lớn hôm nay, ai ở cuối có khi lại được gió đẩy!',
    storm: 'Bão sông! Đá ngầm và xoáy nước khắp nơi, cực kỳ khó lường!'
  };
  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return h;
  }
  function line(event, nameOf) {
    const id = event.skill || event.hazard, a = nameOf(event.actorId);
    const hasTarget = Number.isInteger(event.targetId) && event.targetId !== event.actorId;
    const fits = list => (list || []).filter(text => text.includes('{b}') === hasTarget);
    const pool = [LINES[`${id}:${event.outcome}`], LINES[event.outcome], LINES.default].map(fits).find(list => list.length)
      || [`${a} ${event.label || ''}`.trim()];
    const pick = pool[hash(`${event.id}|${event.time}`) % pool.length];
    return pick.replaceAll('{a}', a).replaceAll('{b}', hasTarget ? nameOf(event.targetId) : '');
  }
  function start(race) {
    const opener = OPENERS[hash(race?.seed ?? 0) % OPENERS.length];
    return race?.weather ? `${opener} ${race.weather.icon} ${race.weather.name}: ${WEATHER[race.weather.id] || ''}`.trim() : opener;
  }
  function finish(winner, runnerUp, close) {
    return close ? `Sát nút! Ảnh chụp vạch đích cho thấy ${winner} thắng ${runnerUp} chỉ trong gang tấc!` : `${winner} về nhất! Một chiến thắng đầy cảm xúc!`;
  }
  const api = Object.freeze({ line, start, finish });
  root.DuckCommentary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
