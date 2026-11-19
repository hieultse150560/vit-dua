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
    'rock:finale': ['Trời ơi! {a} vấp đá ngay trước vạch đích, mất ngôi đầu!', 'Kịch tính tột độ! {a} sắp về nhất thì vấp đá ngã lăn!', '{a} chỉ còn một quãng nữa là tới vạch đích… và vấp đá! Ngôi đầu đổi chủ!'],
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
    // chaos-v4 skills
    'pho:eat': ['{a} tấp vào ven sông húp vội tô phở, no bụng rồi bơi như bay!', 'Phở tái lăn! {a} ăn xong là phóng vèo vèo!'],
    'coffee:awake': ['{a} làm ly cà phê sữa đá, tỉnh như sáo, đánh gì cũng không ngã!', 'Cà phê vào, {a} mắt sáng rỡ, bơi băng băng!'],
    'cash:hit': ['{a} rải tiền khắp mặt sông, tốp đầu dừng lại nhặt lấy nhặt để!', 'Tiền rơi tiền rơi! Mấy con dẫn đầu quên cả đua vì tiền của {a}!'],
    'net:hit': ['{a} quăng lưới chụp gọn {b}, giãy mãi không ra!', 'Một mẻ lưới! {b} bị {a} tóm sống!'],
    'kite:fly': ['{a} thả diều bay vút lên trời, vượt qua mọi chướng ngại!', 'Diều no gió! {a} lơ lửng lướt đi như chim!'],
    'cloud:hit': ['Mây đen kéo tới trên đầu {b}! {a} gọi mưa đổ xuống!', '{a} triệu hồi mây đen, {b} đội mưa bơi lóp ngóp!'],
    'cloud:struck': ['Đùng! Mây đen của {a} giáng sét trúng {b}!', 'Sét từ mây đen! {b} lật nhào, đúng như {a} tính!'],
    'hourglass:frozen': ['{a} lật ngược đồng hồ cát, mọi con phía trước đứng hình!', 'Thời gian ngừng trôi! Chỉ mình {a} còn bơi!'],
    'hourglass:none': ['{a} lật đồng hồ cát nhưng ai cũng có phao, thời gian vẫn trôi!'],
    'loudspeaker:none': ['{a} bật loa phường nhưng ai cũng có phao, chẳng ai thèm giật mình!'],
    'loudspeaker:startled': ['Loa phường của {a} vang lên, cả đám giật bắn mình!', 'A lô a lô! {a} bật loa, mấy con xung quanh khựng lại!'],
    'portal:teleport': ['{a} chui vào cổng không gian… trồi ra hạng {n}!', 'Vèo! Cổng không gian đưa {a} tới hạng {n}!'],
    'xeom:ride': ['{a} vẫy xe ôm, chở vượt một mạch!', 'Bác xe ôm chạy hết ga, {a} vượt lên ầm ầm!'],
    'dolphin:boost': ['Cá heo xuất hiện, cõng {a} lên phía trước!', '{a} được cá heo cho đi nhờ! Vui quá!'],
    'ghost-pass': ['Đòn của {a} xuyên qua bóng ma {b}!'],
    blocked: ['{b} có lá chắn, đòn của {a} tan biến!', 'Đỡ được rồi! {a} vô vọng trước {b}!', 'Phao cứu {a} một bàn thua trông thấy!'],
    reflected: ['Đòn của {a} bị gương của {b} dội ngược!', '{a} tấn công {b} và… tự hại mình!', 'Gương thần! Đòn của {a} bị dội ngược về chính nó!'],
    immune: ['{b} đang miễn nhiễm, {a} đánh hụt!', '{a} ra đòn nhưng không ăn thua!', '{a} vẫn còn choáng nên không sao!'],
    default: ['{a} tung chiêu vào {b}!', '{a} ra tay!'],
    // Lane moments (race rooms). Lanes draw every jump thing as a rock and every dive thing as a gull ({o}).
    'obstacle:up:dodged': ['{a} nhảy phốc qua {o}!', 'Hây! {a} bật qua {o} gọn gàng!'],
    'obstacle:down:dodged': ['{a} lặn xuống, {o} sượt qua đầu!', '{a} ngụp đầu né {o} trong gang tấc!'],
    'obstacle:up:hit': ['{a} đâm sầm vào {o}, lật nhào!', 'Ối! {a} quên nhảy, vấp {o}!'],
    'obstacle:down:hit': ['Cộp! {a} không kịp lặn, bị {o} đâm trúng!', '{a} đụng ngay {o}, choáng váng!'],
    'obstacle:lucky': ['{a} may mắn lách qua {o}!'],
    'obstacle:over': ['{a} bay vèo qua {o}!'],
    'obstacle:smashed': ['{a} khổng lồ, {o} chẳng cản nổi!'],
    'obstacle:immune': ['{a} va phải {o} mà chẳng hề hấn gì!'],
    'rune:up:grabbed': ['{a} nhảy lên đớp gọn {o}!', 'Ngon! {a} bật cao ăn trúng {o}!'],
    'rune:down:grabbed': ['{a} lặn xuống nhặt được {o}!', '{a} ngụp sâu, vớt gọn {o}!'],
    'rune:lucky': ['Hên quá! {a} vớ được {o}!'],
    'rune:missed': ['{a} để tuột mất {o}!', 'Tiếc quá! Viên {o} trôi qua mặt {a}!'],
    // Race room: an area skill its owner aimed past the leaders ({c} = the ducks it struck).
    aimed: ['{a} chỉ mặt điểm tên, {c} lãnh trọn!', '{a} bỏ qua tốp đầu, nhắm thẳng {c}!', 'Có thù riêng chăng? {a} nhắm đúng {c}!']
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
  const LANE_NAMES = { up: 'tảng đá', down: 'con chim sà', speed: 'rune tốc độ', bubble: 'rune bong bóng' };
  function laneLine(event, a) {
    const kind = event.rune ? 'rune' : 'obstacle', o = LANE_NAMES[event.rune || event.key] || 'chướng ngại';
    const pool = LINES[`${kind}:${event.key}:${event.outcome}`] || LINES[`${kind}:${event.outcome}`] || [`${a} ${event.label || ''}`.trim()];
    return pool[hash(`${event.id}|${event.time}`) % pool.length].replaceAll('{a}', a).replaceAll('{o}', o);
  }
  function line(event, nameOf) {
    const id = event.skill || event.hazard, a = nameOf(event.actorId);
    if (event.type === 'obstacle') return laneLine(event, a);
    const hasTarget = Number.isInteger(event.targetId) && event.targetId !== event.actorId;
    const fits = list => (list || []).filter(text => text.includes('{b}') === hasTarget);
    // Copycat: credit the thief, then call the move it copied.
    if (event.skill === 'copycat' && event.copied) return `${a} học lỏm chiêu ${event.copiedName}! ${line({ ...event, skill: event.copied }, nameOf)}`;
    const guardLines = { ghost: LINES['ghost-pass'], dodge: LINES['dodge-pass'], lucky: LINES['lucky-pass'] };
    const lists = [event.finale && LINES['rock:finale'], guardLines[event.guard], event.aimed && LINES.aimed, LINES[`${id}:${event.outcome}`], LINES[event.outcome], LINES.default].map(fits);
    const at = lists.findIndex(list => list.length), pool = lists[at] || [`${a} ${event.label || ''}`.trim()];
    const struck = (event.affectedIds || []).filter(id => id !== event.actorId).map(nameOf);
    const c = struck.length > 1 ? `${struck.slice(0, -1).join(', ')} và ${struck.at(-1)}` : struck[0] || '';
    const said = (at === 2 && event.label ? `${event.label[0]}${event.label.slice(1).toLowerCase()} ` : '')
      + pool[hash(`${event.id}|${event.time}`) % pool.length];
    return said.replaceAll('{a}', a).replaceAll('{b}', hasTarget ? nameOf(event.targetId) : '').replaceAll('{c}', c).replaceAll('{n}', String(event.roll ?? event.rank ?? ''));
  }
  function start(race) {
    const opener = OPENERS[hash(race?.seed ?? 0) % OPENERS.length];
    return race?.weather ? `${opener} ${race.weather.icon} ${race.weather.name}: ${WEATHER[race.weather.id] || ''}`.trim() : opener;
  }
  function finish(winner, runnerUp, close) {
    return close ? `Sát nút! Ảnh chụp vạch đích cho thấy ${winner} thắng ${runnerUp} chỉ trong gang tấc!` : `${winner} về nhất! Một chiến thắng đầy cảm xúc!`;
  }
  // The round's last duck gets a poem, a song or a rap: chin up, and thanks for feeding the fund. {n} = its owner.
  const CHEERS = [
    ['poem', 'Về chót đâu phải là thua,', 'Nhường anh em nhất, để mua tiếng cười.', 'Ví tiền có mỏng đôi mươi,', 'Quỹ chung thêm béo, cả mười người vui!'],
    ['poem', 'Vịt ai bơi cuối hàng xa,', 'Hóa ra mạnh thường quân là chính đây.', 'Hôm nay ví có hơi gầy,', 'Mai kia quỹ béo, cả bầy nhớ ơn.'],
    ['poem', 'Thua keo này, bày keo sau,', 'Tiền rơi vào quỹ, có đâu mất phần.', 'Hôm nay về chót một lần,', 'Mai kia lội ngược, xa gần nể ghê!'],
    ['poem', 'Bơi sau chẳng phải bơi hèn,', 'Ấy là nhường bạn đi lên trước mình.', 'Ví tiền chịu cảnh hi sinh,', 'Cả làng vỗ tay, tôn vinh anh hùng!'],
    ['poem', 'Rùa xưa thắng thỏ hôm nao,', 'Vịt ta về chót, có sao đâu mà.', 'Tiền này góp quỹ chung nhà,', 'Cuối mùa liên hoan, chén là nhớ ai!'],
    ['poem', '{n} ơi, chớ có buồn lâu,', 'Về sau cùng nhất, đứng đầu tấm lòng.', 'Ví tiền vơi, quỹ thêm đông,', 'Cuối mùa liên hoan, ai không nhớ {n}!'],
    ['poem', 'Đường đua có lúc lên xuống,', 'Hôm nay về chót, mai uống trà chanh.', 'Tiền này góp quỹ cho nhanh,', 'Để mùa sau nữa đua tranh hăng hơn!'],
    ['song', 'Quạc quạc quạc, {n} ơi đừng buồn,', 'Tiền đi tiền lại, quỹ chung vẫn còn.', 'Mai ta lật kèo, bơi vượt cả đoàn,', 'Quạc quạc quạc, {n} ơi đừng buồn!'],
    ['song', 'Ai bơi chậm nhất sông này? {n} đó!', 'Ai góp quỹ đầy hôm nay? Cũng {n} luôn!', 'La la la, vịt chậm mà lòng rộng như sông!'],
    ['song', 'Hôm nay {n} về chót,', 'Nhưng ví {n} rộng nhất làng.', 'Cả hội cùng hát vang:', 'Cảm ơn mạnh thường quân!'],
    ['song', 'Vinh danh {n}, mạnh thường quân của mùa!', 'Một lòng vì quỹ, một ví vì anh em.', 'Hôm nay về chót, mai này về nhất,', 'Hát lên nào, cả sông cùng hò reo!'],
    ['rap', 'Yo! Về chót không sao, {n} vẫn ngẩng cao đầu,', 'Ví mỏng một chút, quỹ chung thì giàu.', 'Cuối mùa liên hoan ai bao? Hỏi đâu xa,', 'Chính là {n}, huyền thoại vịt bơi sau!']
  ];
  const CHEER_KIND = {
    poem: ['📜', 'Thơ tặng {n} về chót', 'Và bây giờ, một bài thơ tặng {n}, người về chót.'],
    song: ['🎵', 'Hát tặng {n} về chót', 'Cả sông cùng hát tặng {n}, người về chót.'],
    rap: ['🎤', 'Rap tặng {n} về chót', 'Lên nhạc! Một đoạn rap tặng {n}, người về chót.']
  };
  // Same race, same owner: the same cheer on every screen.
  function cheer(name, seed) {
    const [kind, ...lines] = CHEERS[hash(`${seed}|${name}`) % CHEERS.length], [icon, title, intro] = CHEER_KIND[kind], fill = text => text.replaceAll('{n}', name);
    return { kind, icon, title: fill(title), intro: fill(intro), lines: lines.map(fill) };
  }
  const api = Object.freeze({ line, start, finish, cheer });
  root.DuckCommentary = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
