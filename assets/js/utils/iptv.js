
function entryInsertAtPath(_index, groupname, group){ // group is entry object of type "group" to be put as last location, create the intermediaries, groupname is like a path
    var structure = buildPathStructure(groupname, group);
    _index = mergeEntriesWithNoCollision(_index, structure);
    return _index;
}

// mergeEntriesWithNoCollision([{name:'1',type:'group', entries:[1,2,3]}], [{name:'1',type:'group', entries:[4,5,6]}])
function mergeEntriesWithNoCollision(leveledIndex, leveledEntries){
    var ok;
    if(Array.isArray(leveledIndex) && Array.isArray(leveledEntries)){
        for(var j=0;j<leveledEntries.length;j++){
            ok = false;
            for(var i=0;i<leveledIndex.length;i++){
                if(leveledIndex[i].type==leveledEntries[j].type && leveledIndex[i].name==leveledEntries[j].name){
                    //console.log('LEVELING', leveledIndex[i], leveledEntries[j])
                    leveledIndex[i].entries = mergeEntriesWithNoCollision(leveledIndex[i].entries, leveledEntries[j].entries);
                    ok = true;
                    break;
                }
            }
            if(!ok){
                //console.log('NOMATCH FOR '+leveledEntries[j].name, leveledIndex, leveledEntries[j]);
                leveledIndex.push(leveledEntries[j]);
                //console.log('noMATCH' , JSON.stringify(leveledIndex).substr(0, 128));
            }
        }
    }
    return leveledIndex;
}

function buildPathStructure(path, group){ // group is entry object of type "group" to be put as last location, create the intermediaries
    var groupEntryTemplate = {name: '', path: '', type: 'group', label: '', entries: []};
    path = path.replace(new RegExp('\\+'), '/');
    var paths = path.split('/');
    var structure = group;
    for(var i=(paths.length - 2);i>=0;i--){
        //console.log(structure);
        var entry = groupEntryTemplate;
        entry.entries = [Object.assign({}, structure)];
        entry.name = paths[i];
        entry.label = '';
        entry.path = paths.slice(0, i + 1).join('/');
        structure = entry;
    }
    return [structure];
}

var ListMan = (() => {

    var self = {}, debug = debugAllow(false)
    
    self.badexts = ['jpg', 'jpeg', 'gif', 'bmp', 'png', 'txt'];
    self.regexes = {
        'group': new RegExp('group\-title *= *["\']*([^,"\']*)', 'i'),
        'logo': new RegExp('tvg\-logo *= *["\']*([^"\']+//[^"\']+)', 'i'),
        'name': new RegExp(',([^,]*)$', 'i'),
        'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
        'validateprotocol': new RegExp('^(magnet:|//|[a-z]+://)', 'i'),
        'validatehost': new RegExp('^(//|https?://)(0\.0\.0\.0|127\.0\.0\.1| )'),
        'nullgroup': new RegExp('(^|[^A-Za-z0-9])N/A([^A-Za-z0-9]|$)', 'i')
    }

    self.key = (key) => {
        return key.replace(new RegExp('[^A-Za-z0-9\\._-]', 'g'), '')
    }

    self.isPath = (o) => {
        return (typeof(o)=='string' && o.length <= 1024 && !o.match("[\t\r\n]") && o.match("[\\\\/]"))
    }

    self.read = (path, callback, timeout) => { // timeout in secs
        if(!timeout){
            timeout = 30;
        }
        if(path.substr(0, 2)=='//'){
            path = 'http:' + path;
        }
        if(path.match('^https?:')){
            var key = 'iptv-read-'+path, fallbackKey = key+'-fb', doFetch = false, data = GStore.get(key);
            if(typeof(data)=='string' && data.length){
                if(debug){
                    console.log('READ CACHED FOR '+key, data.length)
                }
                callback(data, path)
            } else {
                if(debug){
                    console.log('READ FETCH FOR '+key)
                }
                var fetchOptions = {redirect: 'follow'};
                fetchTimeout(path, (r) => {
                    if(typeof(r)=='string' && r.indexOf('#EXT')!=-1){
                        if(debug){
                            console.log('READ SAVE FOR '+key, r.length)
                        }
                        r = self.extract(r);
                        if(debug){
                            console.log('READ EXTRACTED FOR '+key, r.length)
                        }
                        GStore.set(key, r, 12 * 3600);
                        GStore.set(fallbackKey, r, 31 * (12 * 3600));
                        callback(r, path)
                    } else {
                        console.error('READ '+path+' returned empty.');
                        data = GStore.get(fallbackKey); // fallback
                        if(typeof(data)!='string'){
                            data = '';
                        }
                        GStore.set(key, data, 12 * 3600); // minor expiral in error
                        callback(data, path)
                    }
                }, timeout * 1000, fetchOptions)
            }
        } else {
            fs.readFile(path, (err, content) => {
                if(typeof(content)!='string'){
                    content = String(content);
                }
                content = self.extract(content);
                callback(content, path)
            })
        }
    }

    self.extract = (content) => { // extract inline lists from HTMLs
        var pos = content.substr(0, 80000).toLowerCase().indexOf('<body');
        if(pos != -1){
            content = content.substr(pos);
            var e = (new RegExp('#(EXTM3U|EXTINF).*', 'mis')).exec(content);
            if(e && e.index){
                content = content.substr(e.index);
                content = content.replace(new RegExp('<[ /]*br[ /]*>', 'gi'), "\r\n");
                e = (new RegExp('</[A-Za-z]+>')).exec(content);
                if(e && e.index){
                    content = content.substr(0, e.index);
                }
            }
        }
        return content;
    }

    self.parseMeta = function (meta){
        // get logo, group and name
        var c = {};
        c.logo = self.parseMetaField(meta, self.regexes['logo']);
        c.group = self.parseMetaField(meta, self.regexes['group']).replaceAll('\\', '/').toUpperCase().replace(self.regexes['nullgroup'], '').trim();
        if(!c.group.length){
            c.group = Lang.NOGROUP;
        }
        c.rawname = self.parseMetaField(meta, self.regexes['name']).trim();
        c.name = c.rawname.replace(self.regexes['notags'], '').trim();
        c.label = basename(c.group);
        c.type = 'stream';
        return c;
    }

    self.parseMetaField = function (meta, rgx, index){
        if(typeof(index)!='number') index = 1;
        var r = meta.match(rgx);
        if(r && r.length > index) return r[index];
        return '';
    }

    self.exportEntriesAsM3U = (entries, noHeader, cb) => {
        var ct = "", vpath = Menu.path;
        if(!noHeader){
            ct += "#EXTM3U\n\n";
        }
        if(Array.isArray(entries)){
            async.forEach(entries, (entry, callback) => {
                if(entry.type == 'stream' && entry.url){
                    if(isMegaURL(entry.url)){
                        var mega = parseMegaURL(entry.url);
                        if(mega && mega.name){
                            search(es => {
                                ListMan.exportEntriesAsM3U(es, true, txt => {
                                    ct += txt
                                    callback()
                                })
                            }, 'all', mega.name, true, false)
                        } else {
                            callback()
                        }
                    } else {
                        ct += "#EXTINF:-1 tvg-name=\""+entry.name+"\" tvg-logo=\""+entry.logo+"\" group-title=\""+(entry.group || "")+"\","+entry.name+"\n"+entry.url+"\n\n";
                        callback()
                    }
                } else {
                    if(entry['renderer'] && entry.type == 'group') {
                        var nentries = entry['renderer'](entry, null, true)
                        if(nentries.length == 1 && nentries[0].class && nentries[0].class.indexOf('entry-loading') != -1) {
                            var vpathIn = assumePath(entry.name, vpath)
                            var es = Menu.asyncResult(vpathIn)
                            //console.warn('ASYNC', entry, vpath, vpathIn, es);
                            if(es){
                                self.exportEntriesAsM3U(es, true, txt => {
                                    ct += txt
                                    callback()
                                })
                            } else {
                                callback()
                            }
                        } else {
                            self.exportEntriesAsM3U(nentries, true, txt => {
                                ct += txt
                                callback()
                            })
                        }
                    } else if(entry['entries']) {
                        self.exportEntriesAsM3U(entry['entries'], true, txt => {
                            ct += txt
                            callback()
                        })
                    } else {
                        callback()
                    }
                }
            }, () => {
                cb(ct)
            })
        } else {
            cb(ct)
        }
    }
    self.parse = (content, cb, timeout, skipFilters, url) => { // parse a list to a array of entries/objects
        if(typeof(content) != 'string'){
            content = String(content)
        }
        if(self.isPath(content)){
            url = content
            if(debug){
                console.log('READING', content, time())
            }
            self.read(content, (icontent, path) => {
                if(debug){
                    console.log('READEN', path, time())
                }
                self.parse(icontent, cb, timeout, skipFilters, url || path)
            }, timeout)
        } else {
            if(debug){
                console.log('PARSING', time(), content.length)
            }
            var parsingStream = null, flatList = [], slist = content.split("\n");
            for(var i in slist){
                if(slist[i].length > 12){
                    if(slist[i].substr(0, 3).indexOf('#')!=-1){
                        parsingStream = self.parseMeta(slist[i])
                    } else if(parsingStream) {
                        parsingStream.url = slist[i].trim();
                        if(parsingStream.url && self.badexts.indexOf(getExt(parsingStream.url)) == -1 && parsingStream.url.match(self.regexes['validateprotocol']) && !parsingStream.url.match(self.regexes['validatehost'])){ // ignore bad stream urls
                            if(url){
                                parsingStream.source = url
                            }
                            flatList.push(parsingStream)
                        }
                        parsingStream = null
                    }
                }
            }
            if(!skipFilters){
                if(debug){
                    console.log('PARSING 2', time())
                }
                flatList = applyFilters('listManParse', flatList);
            }
            if(debug){
                console.log('PARSED', time())
            }
            cb(flatList)
        }
    }

    self.deepParse = (content, callback) => { // parse to a multidimensional array
        if(!Array.isArray(content)){
            self.parse(content, (c) => {
                self.deepParse(c, callback)
            })
        } else {
            var parsedGroups = {}, flatList = content
            for(var i=0;i<flatList.length;i++){
                if(typeof(parsedGroups[flatList[i].group])=='undefined'){
                    parsedGroups[flatList[i].group] = []
                }
                parsedGroups[flatList[i].group].push(flatList[i])
            }
            var groupedEntries = [];
            for(var k in parsedGroups){
                groupedEntries.push({name: basename(k), path: k, type: 'group', label: '', entries: parsedGroups[k]});
            }
            var recursivelyGroupedList = [];
            for(var i=0; i<groupedEntries.length; i++){
                if(groupedEntries[i].path.indexOf('/')!=-1){ // no path
                    recursivelyGroupedList = entryInsertAtPath(recursivelyGroupedList, groupedEntries[i].path, groupedEntries[i])
                }
            }
            for(var i=0; i<groupedEntries.length; i++){
                if(groupedEntries[i].path.indexOf('/')==-1){ // no path
                    recursivelyGroupedList = mergeEntriesWithNoCollision(recursivelyGroupedList, [groupedEntries[i]])
                }
            }
            recursivelyGroupedList = applyFilters('listManDeepParse', recursivelyGroupedList);
            callback(recursivelyGroupedList, content)
        }
    }

    return self;
})();

function listManMergeNames(a, b){
    var la = a.toLowerCase();
    var lb = b.toLowerCase();
    if(la.indexOf(lb)!=-1){
        return a;
    }
    if(lb.indexOf(la)!=-1){
        return b;
    }
    return a+' - '+b;
}

function listManJoinDuplicates(flatList){
    var already = {}, map = {};
    for(var i=0; i<flatList.length; i++){
        if(!flatList[i]){
            delete flatList[i];
        } else if((typeof(flatList[i].type)=='undefined' || flatList[i].type=='stream') && !flatList[i].prepend){
            if(typeof(already[flatList[i].url])!='undefined'){
                var j = map[flatList[i].url];
                if(flatList[j].name != flatList[i].name){
                    flatList[j].name = listManMergeNames(flatList[j].name, flatList[i].name);
                    flatList[j].rawname = listManMergeNames(flatList[j].rawname || flatList[j].name, flatList[i].rawname || flatList[j].name);
                }
                delete flatList[i];
            } else {
                already[flatList[i].url] = 1;
                map[flatList[i].url] = i;
            }
        }
    }
    return flatList.filter((item) => {
        return item !== undefined;
    })
}

addFilter('listManParse', listManJoinDuplicates);

var folderSizeLimit = 96, folderSizeLimitTolerance = 12;

function listManGetLetterRange(entries){
    var l, start = '0', end = 'Z', r = new RegExp('[A-Za-z0-9]');
    for(var i=0; i<entries.length; i++){
        l = entries[i].name.charAt(0);
        if(l.match(r)){
            start = l.toUpperCase();
            break;
        }
    }
    for(var i=(entries.length - 1); i>=0; i--){
        l = entries[i].name.charAt(0);
        if(l.match(r)){
            end = l.toUpperCase()
            break;
        }
    }
    return (start==end)?start:start+'-'+end;
}

function listManPaginateGroup(groupEntry){
    //console.log('CC', groupEntry.entries.length);
    var group, entries = [], template = groupEntry, n = 1, already = {};
    for(var i=0; i<groupEntry.entries.length; i += folderSizeLimit){
        group = Object.assign({}, template);
        //console.log('CD', i, folderSizeLimit);
        group.entries = groupEntry.entries.slice(i, i + folderSizeLimit);
        group.name += ' '+listManGetLetterRange(group.entries);
        if(typeof(already[group.name])!='undefined'){
            already[group.name]++;
            group.name += ' '+already[group.name];
        } else {
            already[group.name] = 1;
        }
        //console.log('DC', group.entries.length);
        entries.push(group);
        n++;
    }
    //console.log('DD', entries.length);
    return entries;
}

function listManPaginate(list){
    //console.log('AA', list.length);
    var nentries;
    for (var i=(list.length - 1); i >= 0; i--){
        if(list[i] && list[i].type=='group' && list[i].entries.length > (folderSizeLimit + folderSizeLimitTolerance)){
            nentries = listManPaginateGroup(list[i]);
            list[i] = nentries.shift();
            for(var j=(nentries.length - 1); j >= 0; j--){
                //console.log('ZZ', j, nentries[j])
                if(typeof(nentries[j])=='object'){
                    list.splice(i + 1, 0, nentries[j])
                }
            }
        }
    }
    //console.log('BB', list.length);
    return list;
}

function listManSortRecursively(list){
    var result = [], entry;
    for (var i=0; i<list.length; i++){
        entry = Object.assign({}, list[i]);
        if(entry.type=='group'){
            if(entry.entries.length){
                if(entry.entries.length == 1){
                    entry = entry.entries[0];
                    entry.path = dirname(entry.path);
                } else {
                    entry.entries = listManSortRecursively(entry.entries);
                    /* nextGroupForLogo
                    for (var j=0; j<entry.entries.length; j++){
                        if(entry.entries[j].logo){
                            entry.logo = entry.entries[j].logo;
                            break;
                        }
                    }
                    */
                }
            }
        }
        result.push(entry)
    }
    result.sort(function(a, b) {
        return (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0)
    }); 
    return result;
}

function listManLabelify(list, locale){
    if(!locale){
        locale = getLocale(false, true)
    }
    var count;
    for (var i=0; i<list.length; i++){
        if(list[i].type=='group'){
            //entry.label = Number(entry.entries.length).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase();
            count = Number(list[i].entries.length);
            if(count == 1){
                list[i] = list[i].entries[0];
                list[i].path = dirname(list[i].path);
                list[i].group = dirname(list[i].group);
            } else {
                list[i].label = count+' '+Lang.STREAMS.toLowerCase();
                list[i].entries = listManLabelify(list[i].entries, locale);
            }
        } else if(list[i].type=='stream') {
            list[i].label = basename(list[i].path || list[i].group);
        }
    }
    return list;
}

addFilter('listManDeepParse', listManSortRecursively);
addFilter('listManDeepParse', listManPaginate);
addFilter('listManDeepParse', listManLabelify);

