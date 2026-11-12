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
    'tornado:shuffled': ['Lốc xoáy của {a} cuốn bay cả tốp đầu, quăng văng về cuối đoàn!', 'Gió lốc nổi lên! {a} hất tung mấy con dẫn đầu ra sau!', 'Vòi rồng của {a} hút tốp đầu lên trời, rơi bõm xuống cuối đoàn!'],
    'tornado:none': ['{a} gọi lốc xoáy nhưng ai cũng có phao, gió thổi qua vô hại!'],
    'banana:dropped': ['{a} thả vỏ chuối ngay trước mũi {b}!', 'Cẩn thận {b}! {a} vừa rải vỏ chuối!'],
    'banana:hit': ['{b} đạp trúng vỏ chuối của {a}, quay như chong chóng!', 'Trượt rồi! {b} xoay tít vì vỏ chuối của {a}!'],
    'buoy:blocked': ['Phao thần của {a} chặn đứng đòn của {b} rồi bật lên!', '{a} đỡ gọn đòn của {b}! Phao quá đỉnh!', 'Phao thần cứu {a} một bàn thua trông thấy, còn bật lên nữa!'],
    'buoy:fallback': ['Phao của {a} bơm căng, đẩy vọt lên phía trước!'],
    'rock:hit': ['Ôi! {a} vấp đá, ngã lăn quay!', 'Hòn đá oan nghiệt! {a} vấp ngã ngay lúc đang dẫn!', '{a} đang dẫn đầu thì… vấp đá! Kịch tính quá!'],
    'croc:hit': ['Cá sấu! {a} bị đớp kéo lùi lại!', 'Một con cá sấu ngoạm lấy {a}! Hú hồn!'],
    'wind:boost': ['Gió thuận thổi bay {a} lên phía trước!', 'Ông trời thương {a}, gió đẩy lên vùn vụt!'],
    'whirlpool:hit': ['Xoáy nước cuốn {a} quay vòng vòng!', '{a} lọt vào xoáy nước, chóng hết cả mặt!'],
    'magnet:pull': ['Nam châm của {a} hút vèo một cái, dính ngay sau con dẫn đầu!', '{a} bật nam châm, bay một mạch lên top!'],
    'lightning:hit': ['Ầm! Sét đánh trúng tốp đầu, {a} cười khoái chí!', 'Trời nổi giông! {a} gọi sét đánh lật cả hai con dẫn đầu!'],
    'lightning:reflected': ['{a} gọi sét nhưng sét dội ngược, tự lãnh đủ!'],
    'flip:swapped': ['Lộn đầu đuôi! {a} khiến con dẫn đầu rơi xuống chót!', 'Không thể tin nổi! {a} đảo ngược đầu và đuôi đoàn đua!'],
    'rewind:rewound': ['{a} tua ngược thời gian, cả đoàn bị kéo lùi lại!', 'Tua lại nào! Mọi con trừ {a} đều về chỗ cũ!'],
    'reverse:hit': ['Bơi ngược chiều! {a} khiến tốp đầu quay đầu bơi lùi!', '{a} làm hai con dẫn đầu lú lẫn, bơi ngược về sau!'],
    'freeze:frozen': ['Đóng băng! Cả sông đứng hình, chỉ mình {a} còn bơi!', '{a} thổi một luồng gió lạnh, mặt sông đóng băng tức thì!'],
    'rock:finale': ['Trời ơi! {a} vấp đá ngay trước vạch đích, mất trắng chiến thắng!', 'Kịch tính tột độ! {a} sắp về nhất thì vấp đá ngã lăn!', '{a} chỉ còn một sải nữa thôi… và vấp đá! Chiến thắng tuột khỏi tay!'],
    'missile:hit': ['Tên lửa tầm nhiệt của {a} bám đuôi {b}… BÙM! Nổ tung!', '{b} chạy đằng trời! Tên lửa của {a} trúng ngay giữa lưng!', 'Một vệt khói dài… và {b} bị {a} thổi bay ngược lại!'],
    'bees:hit': ['Đàn ong của {a} bu kín tốp đầu, chạy không nổi!', 'Vo ve vo ve! {a} thả ong đuổi hai con dẫn đầu!'],
    'blackhole:hit': ['Hố đen của {a} nuốt chửng {b}, nhả ra tận cuối đoàn!', '{b} bị hố đen của {a} hút mất tăm, rơi xuống chót bảng!', 'Không gian xoắn lại! {a} tặng {b} một vé về cuối đoàn!'],
    'ghost:ghost': ['Ma kìa! {a} hóa ma lướt xuyên qua đoàn, hù mấy con phía trước sợ chết khiếp!', '{a} biến thành bóng ma, xuyên qua đối thủ vèo vèo, đánh gì cũng trượt!'],
    'balloon:hit': ['{a} buộc bóng bay vào {b}, nhấc bổng lên trời!', '{b} lơ lửng giữa không trung, quà của {a} đấy!'],
    'hippo:hit': ['Hà mã trồi lên! {a} bị hất văng ra sau!', 'Ầm! Một con hà mã ngóc đầu dậy ngay dưới {a}!'],
    'log:hit': ['Khúc gỗ trôi chắn ngang mũi {a}, kẹt cứng!', '{a} đâm sầm vào khúc gỗ! Đau quá!'],
    'frog:boost': ['Ộp ộp! Ếch cõng {a} nhảy cóc lên trước!', '{a} được bầy ếch cho đi nhờ, bật nhảy vèo vèo!'],
    'bomb:armed': ['{a} gắn bom hẹn giờ lên {b}! Tích tắc… tích tắc…', 'Bom của {a} dính lên {b}! Ai dẫn đầu thì người đó ôm bom!'],
    'bomb:hit': ['BÙM! Bom của {a} nổ tung ngay trên đầu {b}!', 'Hết giờ! {b} ôm trọn quả bom của {a}!', 'BÙM! {a} tự ôm bom của chính mình, nổ tung!'],
    'dice:roll': ['{a} gieo xúc xắc ra {n}! Vọt lên ngay!', 'Lốc cốc lốc cốc… {a} được {n} điểm, lướt lên phía trước!'],
    'dice:bust': ['{a} gieo ra 1… tự lật thuyền! Đen thôi đỏ quên đi!', 'Xúc xắc phản chủ! {a} ra 1, lật nhào!'],
    'lullaby:asleep': ['{a} cất giọng ru, cả đám xung quanh ngủ gật!', 'Ầu ơ… {a} hát ru, mấy con gần đó gục đầu ngủ say!'],
    'lullaby:none': ['{a} hát ru nhưng ai cũng có phao, chẳng ai buồn ngủ!'],
    'hex:hit': ['{a} vung đũa phép, {b} hóa thành ếch!', 'Úm ba la! {b} biến thành ếch nhảy cà nhắc, phép của {a} đấy!'],
    'giant:giant': ['{a} ăn nấm hóa khổng lồ, giẫm bẹp mấy con phía trước!', 'Ầm ầm! {a} to như núi, lao lên như xe tăng!'],
    'kraken:grabbed': ['Bạch tuộc khổng lồ của {a} trồi lên, xúc tu tóm gọn cả tốp đầu!', 'Ối! Xúc tu ở đâu ra thế này? {a} gọi thủy quái giữ chân mấy con dẫn đầu!'],
    'dragon:swept': ['Rồng nước của {a} bay dọc sông, quật tung mọi con phía trước!', 'Thần long xuất thế! {a} cưỡi rồng, cả đoàn phía trước dạt sạch!'],
    'dragon:boost': ['{a} đang dẫn mà còn cưỡi rồng nước bay lên! Quá đỉnh!'],
    'meteor:hit': ['Mưa sao băng! Trời sập xuống đầu tốp đầu, quà của {a} đấy!', '{a} ước một điều, và sao băng rơi trúng mấy con dẫn đầu!'],
    'whale:fly': ['Cá voi trồi lên phun {a} bay vút lên trời, đáp xuống tóe nước tung trời!', 'Cá voi cõng {a}! Bay qua đầu mấy con một cách ngoạn mục!'],
    'ufo:hit': ['Đĩa bay xuất hiện! {b} bị hút lên trời, rồi thả tõm xuống cuối đoàn! Tác giả: {a}!', 'Người ngoài hành tinh bắt cóc {b}! {a} cười tủm tỉm!'],
    'ufo:mistake': ['Ơ kìa! Đĩa bay của {a} bắt nhầm chính chủ… và thả {a} lên tốp đầu! May quá!', 'Người ngoài hành tinh nhầm người, {a} được chở miễn phí lên phía trước!'],
    'pirate:hit': ['Tàu cướp biển của {a} nã đại bác! Bùm bùm bùm, ba con phía trước tối tăm mặt mũi!', 'Yo ho ho! {a} kéo cờ đen, bắn tơi bời mấy con trước mặt!'],
    'wheel:jackpot': ['Vòng quay của {a} dừng ở ô ĐỘC ĐẮC! Vọt lên sát con dẫn đầu!', 'Trúng lớn rồi! {a} quay trúng độc đắc!'],
    'wheel:swapped': ['Vòng quay của {a} ra ô Lộn đầu đuôi! Con dẫn đầu và con chót đổi chỗ!'],
    'wheel:frozen': ['Vòng quay của {a} ra ô Đóng băng! Tốp đầu đứng hình!'],
    'wheel:bust': ['Vòng quay của {a} ra ô TRƯỢT… tự lật thuyền! Đen quá!', 'Hên xui mà! {a} quay trúng ô xui, úp mặt xuống sông!'],
    'anchor:hit': ['{a} quăng mỏ neo móc chặt {b}! Kéo lê như kéo xà lan!', 'Keng! Mỏ neo của {a} quấn lấy {b}, còn {a} được dây xích kéo vọt lên!'],
    'volcano:erupted': ['Núi lửa phun trào! {a} gọi nham thạch, đá bay tứ tung!', 'Ầm ầm! Núi lửa giữa sông! {a} gây hỗn loạn khắp nơi!'],
    'fireworks:hit': ['Pháo hoa rực trời! {a} bắn pháo, rơi trúng ai người đó lật!', 'Đẹp quá mà cũng nguy hiểm quá! Pháo hoa của {a} rơi lả tả xuống đường đua!'],
    'dodge-pass': ['{b} lắt léo né gọn đòn của {a}!', 'Né đẹp! Đòn của {a} trượt khỏi {b} trong gang tấc!'],
    'lucky-pass': ['{a} tốt số thật, thoát nạn trong gang tấc!', 'Trời thương {a}! Tai họa đi lướt qua!'],
    'dolphin:boost': ['Cá heo xuất hiện, cõng {a} lên phía trước!', '{a} được cá heo cho đi nhờ! Vui quá!'],
    'ghost-pass': ['Đòn của {a} xuyên qua bóng ma {b}!'],
    blocked: ['{b} có lá chắn, đòn của {a} tan biến!', 'Đỡ được rồi! {a} vô vọng trước {b}!', 'Phao cứu {a} một bàn thua trông thấy!'],
    reflected: ['Đòn của {a} bị gương của {b} dội ngược!', '{a} tấn công {b} và… tự hại mình!', 'Gương thần! Đòn của {a} bị dội ngược về chính nó!'],
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
    // Copycat: credit the thief, then call the move it copied.
    if (event.skill === 'copycat' && event.copied) return `${a} học lỏm chiêu ${event.copiedName}! ${line({ ...event, skill: event.copied }, nameOf)}`;
    const guardLines = { ghost: LINES['ghost-pass'], dodge: LINES['dodge-pass'], lucky: LINES['lucky-pass'] };
    const pool = [event.finale && LINES['rock:finale'], guardLines[event.guard], LINES[`${id}:${event.outcome}`], LINES[event.outcome], LINES.default].map(fits).find(list => list.length)
      || [`${a} ${event.label || ''}`.trim()];
    const pick = pool[hash(`${event.id}|${event.time}`) % pool.length];
    return pick.replaceAll('{a}', a).replaceAll('{b}', hasTarget ? nameOf(event.targetId) : '').replaceAll('{n}', String(event.roll ?? ''));
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
