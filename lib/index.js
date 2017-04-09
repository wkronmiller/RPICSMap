import cheerio from 'cheerio';
import fetch from 'node-fetch';

const URL_ROOT = 'http://catalog.rpi.edu';

//const startUrl = `${URL_ROOT}/content.php?catoid=15&navoid=367`;
const startUrl = 'http://catalog.rpi.edu/content.php?filter%5B27%5D=CSCI&filter%5B29%5D=&filter%5Bcourse_type%5D=-1&filter%5Bkeyword%5D=&filter%5B32%5D=1&filter%5Bcpage%5D=1&cur_cat_oid=15&expand=&navoid=367&search_database=Filter&filter%5Bexact_match%5D=1#acalog_template_course_filter'; //CSCI only

function handleError(error) {
    console.error(error);
    throw error;
}

function getHtml(url) {
    return fetch(url)
        .then(res => res.text())
        .catch(handleError);
}

function getDom(url) {
    return getHtml(url).then(cheerio.load);
}

function getTableLinks($) {
    return $('td a')
        .map((_, a) => $(a).attr('href'))
        .get();
}

function getPageLinks(tableLinks) {
    return tableLinks
        .filter(url => url.indexOf('/content.php') === 0)
        .filter(url => url.endsWith('#acalog_template_course_filter'));
}

function getCourseLinks(tableLinks) {
    return tableLinks
        .filter(url => url.startsWith('preview_course_nopop.php?catoid='));
}

function parseCourseLink(courseLink) {
    const coidRe = /&coid=([0-9]*)/;
    const [, coid, ] = courseLink.match(coidRe);
    const catoRe = /catoid=([0-9]*)/;
    const [, catoid, ] = courseLink.match(catoRe);
    return {courseLink: `${URL_ROOT}/${courseLink}`, coid, catoid};
}

function getPrereqStr($) {
    const [prereqParent] = $('strong:contains(\'Prerequisites\')').get();
    const prereq = prereqParent ? prereqParent.next.data.trim() : null;
    return prereq;
}

function matchCourseIds(str) {
    return str.match(/[A-Z]+ [0-9]+/g);
}

function parsePrereqNotes(prereqNotes) {
    if(!prereqNotes) { return null; }
    const coreqStart = prereqNotes.toLowerCase().indexOf('coreq');
    const prereqOnly = prereqNotes.slice(0, coreqStart);
    const prereqCourseIds = matchCourseIds(prereqOnly);
    const coreqOnly = prereqNotes.slice(coreqStart);
    const coreqCourseIds = matchCourseIds(coreqOnly);
    return {
        prereq: {
            courseIds: prereqCourseIds,
            text: prereqOnly,
        },
        coreq: {
            courseIds: coreqCourseIds,
            text: coreqOnly,
        },
    };
}

function parseTitle(courseInfo) {
    const {title} = courseInfo;
    const [courseId] = title.match(/^[A-Z]+ [0-9]+/);
    const [, courseName,] = title.match(/- ([a-z A-Z 0-9\s]+)/);
    courseInfo.courseId = courseId.trim();
    courseInfo.courseName = courseName.trim();
    return courseInfo;
}

async function loadCoursePage(courseInfo) {
    const {courseLink} = courseInfo;
    console.log(courseLink);
    const $ = await getDom(courseLink); 
    courseInfo.prereqNotes = getPrereqStr($);
    courseInfo.prereqInfo = parsePrereqNotes(courseInfo.prereqNotes);
    courseInfo.title = $('h1').text().trim();
    parseTitle(courseInfo);
    courseInfo.description = $('hr').text().trim();
    return courseInfo
}

async function loadCatalogPage(url) {
    const $ = await getDom(url); 
    const tableLinks = getTableLinks($);
    const pageLinks = getPageLinks(tableLinks);
    const courseLinks = getCourseLinks(tableLinks);
    const courseInfos = await Promise.all(courseLinks.map(parseCourseLink)/*.slice(10,14)*/.map(loadCoursePage)); //TODO: remove slice
    console.log(courseInfos);
    //TODO: load next page(s)
    return courseInfos;
}

// Proof-of-concept D3 data. The parsed data should go into a database.
import flatMap from 'flatmap';
function mkGraphData(courseInfos) {
    const prereqs = courseInfos
        .filter(({prereqInfo}) => prereqInfo)
        .map(({courseId, prereqInfo: {prereq}}) => ({courseId, prereq}))
        .map(({courseId, prereq}) => ({courseId, prereqs: prereq.courseIds}));
    const links = flatMap(prereqs, ({courseId, prereqs}) => {
        if(!prereqs) { return []; }
        return prereqs.map(prereqId => ({source: prereqId, target: courseId}));
    });
    const idSet = links.reduce((set, {source, target}) => {
        set.add(source);
        set.add(target);
        return set;
    }, new Set());
    const nodes = [...idSet].map(id => ({id}));
    return {nodes, links};
}

import fs from 'fs';
(async function main() {
    const courseInfos = await loadCatalogPage(startUrl);
    const graph = mkGraphData(courseInfos);
    fs.writeFileSync('docs/courseInfos.json', JSON.stringify(graph));
})();
