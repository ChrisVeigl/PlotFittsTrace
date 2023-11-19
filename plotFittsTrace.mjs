/*

  plotFittsTrace.mjs
  
  This application generates visualisations for GoFitts .sd3 trace data files 
  (for mor information see: https://www.yorku.ca/mack/FittsLawSoftware/,  https://www.yorku.ca/mack/FittsLawSoftware/doc/GoFitts.html)
  
  The source code of this application is based upon the uit-fitts-law project by Simon Wallner:
  https://github.com/SimonWallner/uit-fitts-law

  The following changes have been applied to the original code:
     * ported to node-js and d3-node for operating in the local file system
	 * updated to d3 version 4
	 * added .sd3 / csv data parser to process data from GoFitts
	 * applied necessary changes to accept data in .sd3 format
	 * added batch processing an commandline arguments

  Many thanks to Scott MacKenzie for his continuous efforts on making Fitts' Law based evaluations accessible to HCI researchers,
  and to Simon Wallner for providing the online visualisation!
  

*/


import fs from 'fs';
import d3node from 'd3-node';
import * as d3 from 'd3';
import csv from 'csv-parser';
import { Command } from 'commander';
import path from 'path';
import os from 'os';


/// constant parameters

var MAX_TIME = 4000;
var MAX_SPEED = 2.5; // pixel/ms
var PLOTPOS_OPACITY = 0.4
var PLOTSPEED_OPACITY = 0.4
const FIRST_DATA_COLUMN=17

/// global variables and data

var actColumn=0
var currentPath = []
var data = [];
var missed=0;
var hits=0;
var plotPositionSVG = null;
var plotVelocitySVG = null;
var plotScatterSVG =null;
var plotScatterEffSVG = null;
var plotHitsSVG = null;
var plotThroughputSVG = null;


/// initialize global variables and SVG containers

function initData() {
	actColumn=0
	currentPath = []
	data = [];
	hits=0;
	missed=0;
	plotPositionSVG = initSVG ( makeDimension(600, 500, 30, 30, 30, 50),  
									{ domain:[-50, 450], description: 'Path distance (px)', ticks:7},
									{ domain:[-150, 150], description: 'Deviation from straight path (px)', ticks:6});

	plotVelocitySVG = initSVG ( makeDimension(600, 500, 30, 30, 30, 50),  
									{ domain:[0, MAX_TIME], description: 'time (ms)', ticks:7},
									{ domain:[MAX_SPEED,0], description: 'velocity (px/ms)', ticks:6});


	plotScatterSVG = initSVG ( makeDimension(500, 400, 30, 30, 30, 50),  
									{ domain:[0.5, 5.5], description: 'ID - Index of Difficulty', ticks:7},
									{ domain:[MAX_TIME, 0], description: 'time in ms', ticks:6});

	plotScatterEffSVG = initSVG ( makeDimension(500, 400, 30, 30, 30, 50),  
									{ domain:[0.5, 6.5], description: 'IDeff - Effective Index of Difficulty', ticks:12},
									{ domain:[MAX_TIME, 0], description: 'time in ms', ticks:10});

	plotHitsSVG = initSVG (makeDimension(300, 300, 50, 50, 50, 50), null, null, true);  // centered SVG

	plotThroughputSVG = initSVG (makeDimension(500, 400, 30, 30, 30, 50));
}
	

/// file system and data processing functions

function prepareSD3File(inputFilename) {
	console.log ("processing file: ",inputFilename);
	try {  
		var dat = fs.readFileSync(inputFilename, 'utf8');
		const lines = dat.split('\n');
		// console.log ("csv header line=",lines [0]);
		if (!lines[0].startsWith('TRACE DATA')) return null;
		// console.log ("csv header line=",lines [1]);
		lines[1] = lines[1].replace("{t_x_y}","t_x_y");  // sorry for that hack - could not get csv column import working otherwise ...
		const remainingContent = lines.slice(1).join('\n');
		
		var osTempFolder=os.tmpdir();
		// console.log ("TEMP=",osTempFolder);
		var tempFilename=osTempFolder+'/temp_'+stripFilename(inputFilename)+'.csv';
		fs.writeFileSync(tempFilename, remainingContent, 'utf8')
		// console.log('Content copied, skipping the first line.');
	} catch(e) {
		console.log('Error:', e.stack);
		return null;
	}	
	return tempFilename;
}

function processNewDataRow(fn,row) 
{
	// console.log("process row:",row);
	if (row.t_x_y == 't=') {
		// console.log('found time column, start building movement data array!');
		actColumn=0;
		let done=false;
		while (done==false) {
			let propName= '_'+(actColumn+FIRST_DATA_COLUMN).toString();
			if ((Object.hasOwn(row,propName)) && (row[propName]!='')) {
				// console.log('got t:', row[propName]);
				currentPath.push({x:0,y:0,t:parseInt(row[propName])});
				actColumn++;
			} else done=true;
		}
	}

	if (row.t_x_y == 'x=') {
		for (let t=0;t<actColumn;t++) {
			let val=row['_'+(t+FIRST_DATA_COLUMN).toString()]
			// console.log('got x:', val);
			currentPath[t].x=parseInt(val);
		}
	}
	
	if (row.t_x_y == 'y=') {
		for (let t=0;t<actColumn;t++) {
			let val=row['_'+(t+FIRST_DATA_COLUMN).toString()]
			// console.log('got y:', val);
			currentPath[t].y=parseInt(val);
		}
		
		// if ((parseInt(row.A) == 400) && (parseInt(row.W) == 20))    //  filter input data if desired
		
		var add=true;
		if ((options.amplitude !=0) && (parseInt(row.A) != options.amplitude)) add=false;
		if ((options.width !=0) && (parseInt(row.W) != options.width)) add=false;
		
		if (add)
			data.push({ A:parseInt(row.A), W:parseInt(row.W), 
					from_x:parseInt(row.from_x), from_y:parseInt(row.from_y),
		            to_x:parseInt(row.to_x),to_y:parseInt(row.to_y),
					dp:currentPath
				 });
		currentPath=[];
	}	
}

/// d3 SVG plot creation from dataset

function createPlots(filePath) 
{
	var groups = [];
	for (let t=0;t<data.length;t++) {

		var actPath = data[t].dp			
		var pathLen = actPath.length;
		// var fromPoint = {x: data[t].from_x, y:data[t].from_y}; // the center of the displayed starting point
		var startPoint = {x: actPath[0].x, y: actPath[0].y};      // the actual starting point of the movement (the last hit point)													  
		var targetPoint = {x: data[t].to_x,   y:data[t].to_y};    // the center of the displayed target point
		var hitPoint = {x: actPath[pathLen-1].x, y: actPath[pathLen-1].y};
		
		var trialTime = actPath[pathLen-1].t;          // timestamp of the last point (hitPoint) is the trial duration
		var dist = distance(targetPoint, startPoint);  // TBD: startPoint or fromPoint?
		var id = shannon(dist, data[t].W);

		// TBD: handle missed targets
		if (distance(hitPoint,targetPoint) > data[t].W) {
			missed += 1;
		}
		else {
			hits += 1;
		}
		// TBD: check if accuracy correction was applied correctly
		
		console.log ("Trial ",t,": A=",data[t].A,", W=",data[t].W, ", from_x=", startPoint.x,", from_y=",startPoint.y, ", to_x=", targetPoint.x,", to_y=",targetPoint.y, ", trialTime=",trialTime, ", distance=",dist.toFixed(1),", ID=",id.toFixed(2)); 
		// for (let i=0;i<pathLen;i++) console.log ("DataPoint ",i," = (",actPath[i].x,"/",actPath[i].y,"/",actPath[i].t,")");		
		

		xPosAvg.clear();
		yPosAvg.clear();
		velAvg.clear();

		plotScatterSVG.group.append('circle')
			.attr('class', 'cat0')
			.style('fill', 'rgb(20,20,250)')
			.attr('cx', plotScatterSVG.scaleX(id))
			.attr('cy', plotScatterSVG.scaleY(trialTime))
			.style('opacity', options.opacity)
			.attr('r', 3)

		var qHit = project(startPoint, targetPoint, hitPoint);
		var hitDeviationX = distance(qHit, targetPoint) * sign(qHit.t - 1);
		var hitDeviationY = distance(qHit, hitPoint) * isLeft(startPoint, targetPoint, hitPoint);

		plotHitsSVG.group.append('circle')
			.attr('class', 'hit')
			.attr('cx', plotHitsSVG.dimension.innerWidth / data[t].W  * hitDeviationX)
			.attr('cy', plotHitsSVG.dimension.innerHeight / data[t].W  * hitDeviationY)
			.attr('r', 3)
			.style('fill', 'red')
			.style('opacity', 1)
		
		// process movement path 
		var last = { x: 0, y: 0, t: 0, v: 0};
		for (var i = 0; i < pathLen; i++) {
			var actPathPoint = actPath[i];
			var q = project(startPoint, targetPoint, actPathPoint);
			var x = distance(q, startPoint) * sign(q.t);  // note that q.t is not the time here but indicates if actPathPoint is located before startPoint or after targetPoint!
			var y = distance(q, actPathPoint) * isLeft(startPoint, targetPoint, actPathPoint);

			// TBD: verify the effect of averaging here!
			x=xPosAvg.process(x);
			y=yPosAvg.process(y);
			
			var dt = actPathPoint.t - last.t;
			var distFromLastPoint = distance(last, {x: x, y: y});
			if (dt > 0)
				var speed = distFromLastPoint / dt;
			else
				var speed = 0;
			
			// TBD: clarify the effect of averaging here!
			speed=velAvg.process(speed);
					
			var opacity=PLOTPOS_OPACITY;
			plotPositionSVG.group.append('svg:line')
				.attr('class', 'live')
				.attr('x1', plotPositionSVG.scaleX(last.x))
				.attr('x2', plotPositionSVG.scaleX(x))
				.attr('y1', plotPositionSVG.scaleY(last.y))
				.attr('y2', plotPositionSVG.scaleY(y))
				.attr('stroke-width', getStrokeWidthForSpeed(speed)) //0.4)
				.style('stroke', getColorForSpeed(speed))
				.style('opacity', opacity)
				//.style('stroke-opacity', 0.5);

			plotVelocitySVG.group.append('svg:line')
				.attr('class', 'live')
				.attr('x1', plotVelocitySVG.scaleX(last.t))
				.attr('x2', plotVelocitySVG.scaleX(actPathPoint.t))
				.attr('y1', plotVelocitySVG.scaleY(last.v))
				.attr('y2', plotVelocitySVG.scaleY(speed))
				.attr('stroke-width', 0.4)
				.style('stroke', getColorForSpeed(speed))
				.style('opacity', PLOTSPEED_OPACITY)
				
			var last = {}
			last.x = x;
			last.y = y;
			last.t = actPathPoint.t;
			last.v = speed;
		}
		
		// create ID-grouped lists
		var groupID = data[t].A.toString() + '_' + data[t].W.toString();
		//var groupID = data[t].W.toString();
		if (!groups[groupID]) {
			groups[groupID] = [];
			console.log ("Created group: "+groupID);
		}

		var realDistance = distance(startPoint, hitPoint); // use real distance here.
		var projectedHitOffsetX = distance(qHit, targetPoint) * sign(qHit.t - 1);
		var projectedHitOffsetY = hitDeviationY;
		
		groups[groupID].push({ startPoint: startPoint, targetPoint:targetPoint, hitPoint: hitPoint, 
							   trialTime: trialTime, realDistance: realDistance, 
							   projectedHitOffsetX: projectedHitOffsetX, projectedHitOffsetY:projectedHitOffsetY
							});		
	}

	// calculate effective values 
	var effectiveData = [];
	for (var group in groups) {
		if (groups[group].length < 3) { // exclude groups with length < 3
			console.log ("Ignore group "+group+" due to insufficient size!");
			continue;
		}
			
		var xEffective = 4.133 * Math.sqrt(variance(groups[group], function(d) { return d.projectedHitOffsetX; }))
		var yEffective = 4.133 * Math.sqrt(variance(groups[group], function(d) { return d.projectedHitOffsetY; }))
		var dEffective = mean(groups[group], function(d) { return d.realDistance; });
		
		for (var i = 0; i < groups[group].length; i++) {
			var datum = groups[group][i];
			var We = Math.min(xEffective, yEffective); // SMALLER-OF model (MacKenzie, Buxton 92)
			var De = dEffective;
			datum.IDe = shannon(De, We);
			datum.throughput = 1000 * (datum.IDe/datum.trialTime);
			datum.groupNum = group
			effectiveData.push(datum);
		}
	}

	drawEffectivePlots(effectiveData);
	augmentHitsPlot();

	// create the svg files
	var fileName=filePath.replace('.sd3','');
    fs.writeFileSync(fileName+'_hitsPlot.svg', plotHitsSVG.node.svgString()); 
    fs.writeFileSync(fileName+'_scatterPlot.svg', plotScatterSVG.node.svgString());
    fs.writeFileSync(fileName+'_positionPlot.svg', plotPositionSVG.node.svgString());
    fs.writeFileSync(fileName+'_velocityPlot.svg', plotVelocitySVG.node.svgString());
	fs.writeFileSync(fileName+'_scatterEffPlot.svg', plotScatterEffSVG.node.svgString());
	fs.writeFileSync(fileName+'_throughputPlot.svg', plotThroughputSVG.node.svgString());
    console.log('Plots created!');

    var htmlContent=`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Fitts Trace Data SVG Images</title>
    </head>
    <body>
        <h1>Fitts Trace Data Analysis - ${fileName}</h1> `

	htmlContent+='<center><div style="margin-bottom: 20px;">';
	htmlContent+=makeImgSrc(fileName+'_positionPlot.svg');
	htmlContent+=makeImgSrc(fileName+'_velocityPlot.svg');
	htmlContent+='</div>';
	htmlContent+='<div style="margin-bottom: 20px;">';
	htmlContent+=makeImgSrc(fileName+'_hitsPlot.svg');
	htmlContent+=makeImgSrc(fileName+'_scatterPlot.svg');
	htmlContent+=makeImgSrc(fileName+'_scatterEffPlot.svg');
	htmlContent+=makeImgSrc(fileName+'_throughputPlot.svg');
	htmlContent+='</div></center>';

	htmlContent = htmlContent + `	
		</body>  
	</html>`;

	fs.writeFileSync(fileName+'_SVGView.html',htmlContent);
	console.log('Html page created!');
}

function stripFilename(fileName) {
	var unifiedFilename=fileName.replace('\\','/');
	var strippedFilename=unifiedFilename.substring(unifiedFilename.lastIndexOf('/') + 1);	
	return (strippedFilename);
}

function makeImgSrc(fileName) {
	var strippedFilename=stripFilename(fileName);
	return (`<img hspace="20" src="${strippedFilename}"</img>`);	
}

function drawEffectivePlots(effectiveData) {
	
	// ============== scatterPlot ====================
	var selectCol = d3.scaleOrdinal(d3.schemeCategory10);
	
	for (var d in effectiveData) {
		if (options.group)
			plotScatterEffSVG.group.append('circle')
				.attr('class', 'cat0')
				.attr('cx', plotScatterEffSVG.scaleX(effectiveData[d].IDe))
				.attr('cy', plotScatterEffSVG.scaleY(effectiveData[d].trialTime))
				.style('opacity', options.opacity)
				.attr('r', 3)
				.style('fill', selectCol(effectiveData[d].groupNum));
		else 
			plotScatterEffSVG.group.append('circle')
				.attr('class', 'cat0')
				.attr('cx', plotScatterEffSVG.scaleX(effectiveData[d].IDe))
				.attr('cy', plotScatterEffSVG.scaleY(effectiveData[d].trialTime))
				.style('opacity', options.opacity)
				.attr('r', 3)
				.style('fill', 'rgb(40,40,230)');

	}
		
	// ============== regression =====================
	var covTIDe = cov(effectiveData,
		function(d) { return d.trialTime; },
		function(d) { return d.IDe});
	
	var varIDe = variance(effectiveData, function(d) { return d.IDe; })
	
	if (varIDe > 0)
		var b = covTIDe / varIDe;
	else
		var b = 0;
	
	var mT = mean(effectiveData, function(d) { return d.trialTime; });
	var mIDe = mean(effectiveData, function(d) { return d.IDe; });
	var a = mT - b * mIDe;
	
	if (!isNaN(a))
	{			
		var makeLine = function(d) {
			return d
				.attr('x1', 0)
				.attr('x2', plotScatterEffSVG.dimension.innerWidth)
				.attr('y1', function(d) { return plotScatterEffSVG.scaleY(d.y1); })
				.attr('y2', function(d) { return plotScatterEffSVG.scaleY(d.y2); })
		}
	
		var regression = plotScatterEffSVG.group.selectAll('line.cat') // + key)
			.data([{y1:a + b * 0.5, y2: a + b * 6.5}]);
	
		regression.enter().append('line')
			.attr('class', 'cat') // + key)
			.style('stroke', 'rgb(108,2,126)')
			.style('stroke-width', 2)
			.call(makeLine);
	}

	// ========= throughput histogram =================
	var histThroughput = d3.histogram()
		.thresholds(20)
		.domain([0,10])
		.value(function(d){return d.throughput;})
		
	var throughputHistogramData = histThroughput(effectiveData)
	
	var histX = d3.scaleLinear()
		.domain([0, d3.max(throughputHistogramData, d => d.x1)])
		.range([0, plotThroughputSVG.dimension.innerWidth]);

	var histY = d3.scaleLinear()
		.domain([0, d3.max(throughputHistogramData, d => d.length)])
		.range([plotThroughputSVG.dimension.innerHeight, 0]);
		
	var throughputRect = plotThroughputSVG.group.selectAll('.bar') // + key)
		.data(throughputHistogramData);
			
	var histXAxis = d3.axisBottom(histX)
		.scale (histX)
		.ticks(20);

	var histYAxis = d3.axisLeft(histY)
		.scale (histY)
		.ticks(10)

	plotThroughputSVG.group.selectAll("g.axis").remove()	
	if (options.captions)
		var desc='histogram of effective throughputs (bits/s)';
	else
		var desc='';
	
	plotThroughputSVG.group.append("g")
		.attr("class", "axis")
		.attr("transform", "translate(0," + plotThroughputSVG.dimension.innerHeight + ")")
		.call(histXAxis.tickSize(3)) //;  //plotThroughputSVG.dimension.innerHeight));
		.append('text')
			.text(desc)
			.attr('x', plotThroughputSVG.dimension.innerWidth/2)
			.attr('y', 25)
			.attr('fill', 'rgb(0,0,0)')
			.style('text-anchor', 'middle');

	//plotThroughputSVG.group.append("g")
	//	.attr("class", "axis")
	//	.call(histYAxis.tickSize(-plotThroughputSVG.dimension.innerWidth));
	
	throughputRect.enter()
		.append('rect')
		.attr('class', 'bar')
		.attr('rx', 3)
		.attr('ry', 3)
		.style('fill', 'rgb(20,20,80)')
		.attr('x', d => histX(d.x0)-9)
		.attr('y', d => histY(d.length))
		.attr('width', d => histX(d.x1 - d.x0) - 1)
		.attr('height', d => plotThroughputSVG.dimension.innerHeight - histY(d.length));
}

function augmentHitsPlot() 
{	
	// draw background circle and arrow for hit accuracy chart
	plotHitsSVG.group.append('circle')
		.attr('cx', 0)
		.attr('cy', 0)
		.attr('r', plotHitsSVG.dimension.innerWidth/2)
		.attr('fill', 'rgb(0,0,0)')
		.style('opacity', 0.1)
	plotHitsSVG.group.append('line')
		.attr('stroke', 'rgb(0,0,0)')
		.attr('x1', 0)
		.attr('y1', 0)
		.attr('x2', -plotHitsSVG.dimension.cx)
		.attr('y2', 0);
	plotHitsSVG.group.append('line')
		.attr('stroke', 'rgb(0,0,0)')
		.attr('x1', 0)
		.attr('y1', 0)
		.attr('x2', -10)
		.attr('y2', -10);
	plotHitsSVG.group.append('line')
		.attr('stroke', 'rgb(0,0,0)')
		.attr('x1', 0)
		.attr('y1', 0)
		.attr('x2', -10)
		.attr('y2', 10);
		
	plotHitsSVG.group.selectAll("g.axis").remove()	
	
	if (options.captions) {
		var hitX=d3.scaleLinear();
		var hitXAxis = d3.axisBottom(hitX)
			.scale(hitX)
			.ticks(0);

		plotHitsSVG.group.append("g")
			.attr("class", "axis")
			.attr("transform", "translate(0," + plotHitsSVG.dimension.innerHeight/2 + ")")
			.call(hitXAxis.tickSize(0)) //;  //plotThroughputSVG.dimension.innerHeight));
			.append('text')
				.text('hit accuracy plot ('+missed+'/'+(hits+missed)+' targets missed)')
				.attr('x', 0)
				.attr('y', 25)
				.attr('fill', 'rgb(0,0,0)')
				.style('text-anchor', 'middle');
	}
}

/// SVG utility functions

function makeDimension(width, height, top, right, bottom, left) {
	return {width: width,
		height: height,
		innerWidth: width - (left + right),
		innerHeight: height - (top + bottom),
		top: top,
		right: right,
		bottom: bottom,
		left: left,
		cx: (width - (left + right)) / 2 + left,
		cy: (height - (top + bottom)) / 2 + top};
}

function initSVG(dim, xA=null, yA=null, center=false) {

	const svgNode = new d3node();
	var svg = svgNode.createSVG(dim.width, dim.height)
		.attr('x', 0)
		.attr('y', 0)
		.attr('width', dim.width)
		.attr('height', dim.height)
		.attr('fill', 'white');

	if (center) {
		var svgGroup = svg.append('g')
			.attr('transform', 'translate('+ dim.width/2 + ',' + dim.height/2 + ' )');
	}
	else {
		var svgGroup = svg.append('g')
			.attr('transform', 'translate('+ dim.left + ',' + dim.top + ' )');
	}

	if (xA != null) {
		if (!options.captions) xA.description='';
		var scaleX = d3.scaleLinear()
			.domain(xA.domain)
			.range([0, dim.innerWidth]);

		var xAxis = d3.axisBottom(scaleX)
			.ticks(xA.ticks)

		svgGroup.append("g")
			.attr("class", "axis")
			.attr('stroke', 'rgb(0,0,0)')
			.attr('stroke-width', 0.2)
			.call(xAxis.tickSize(dim.innerHeight))
			.append('text')
				.text(xA.description)
				.attr('x', dim.innerWidth/2)
				.attr('y', dim.innerHeight + 25)
				//.attr('stroke', 'rgb(0,100,0)')
				.attr('fill', 'rgb(0,0,0)')
				.style('text-anchor', 'middle');
	}
	
	if (yA != null) {
		if (!options.captions) yA.description='';

		var scaleY = d3.scaleLinear()
			.domain(yA.domain)
			.range([0, dim.innerHeight]);

		var yAxis = d3.axisLeft(scaleY)
			.ticks(yA.ticks)

		svgGroup.append("g")
			.attr("class", "axis")
			.attr('stroke', 'rgb(0,0,0)')
			.attr('stroke-width', 0.2)
			.call(yAxis.tickSize(-dim.innerWidth))
				 .append('text')
					.text(yA.description)
					.attr('fill', 'rgb(0,0,0)')
					.attr('x', -dim.innerHeight/2)
					.attr('y', -35)
					.attr('transform', 'rotate(-90, 0, 0)')
					.style('text-anchor', 'middle');
	}

	return {group: svgGroup, node: svgNode, scaleX: scaleX, scaleY: scaleY, dimension: dim};
}


// math utility- and statistics functions
// many thanks to Simon Wallner, https://github.com/SimonWallner/uit-fitts-law

function getColorForSpeed(v) {
	var intensity = clampInt(0, 200, (v / MAX_SPEED) * 200);
	//var colour = 'rgb('+intensity+','+intensity+','+intensity+')';
	 var colour = 'rgb('+intensity+',0,0)';
	return colour;
};


function getStrokeWidthForSpeed(v) {
	var width = clampInt(0, 200, (v / MAX_SPEED) * 200);
	return 0.2 + 20/(width+20);
};

// _empirical_ covariance
function cov(data, extractorA, extractorB) {
	
	if (data.length <= 1) { // no covariance for 0 or 1 element.
		return 0;
	}

	var mA = mean(data, extractorA);
	var mB = mean(data, extractorB);
	
	var cov = 0;
	for (var i = 0; i < data.length; i++) {
		cov += (extractorA(data[i]) - mA) * (extractorB(data[i]) - mB);
	}
	
	return cov / (data.length - 1);
}

function variance(data, extractor) {
	return cov(data, extractor, extractor);
}

function mean(data, extractor) {
	var sum = 0;
	for (var i = 0; i < data.length; i++) {
		sum += extractor(data[i]);
	}
	return sum / data.length;
}

function randomAB(a, b) {
	return a + Math.random() * (b - a);
}

function assSize(assArr) {
	var size = 0;
	for (var _ in assArr) {
		size++;
	}
	return size;
}

function assFirstKey(assArr) {
	for (var key in assArr) {
		return key;
		break;
	}
}

function assIsKey(needle, assArr) {
	for (var key in assArr) {
		if (needle == key) {
			return true;
		}
	}
	return false;
}

/**
 * Project a point q onto the line p0-p1
 * Code taken from: http://www.alecjacobson.com/weblog/?p=1486
 */
function project(A, B, p) {
	var AB = minus(B, A);
	var AB_squared = dot(AB, AB);
	if (AB_squared == 0) {
		return A;
	}
	else {
		var Ap = minus(p, A);
		var t = dot(Ap, AB) / AB_squared;
		return {x: A.x + t * AB.x,
				y: A.y + t * AB.y,
				t: t};
	}
}

function dot(a, b) {
	return (a.x * b.x) + (a.y * b.y);
}

// coutesy of http://stackoverflow.com/questions/3461453/determine-which-side-of-a-line-a-point-lies
function isLeft(A, B, p){
     return ((B.x - A.x)*(p.y - A.y) - (B.y - A.y)*(p.x - A.x)) >= 0 ? 1: -1;
}

function minus(a, b) {
	return {x: a.x - b.x, y: a.y - b.y};
}

function distance(a, b) {
	var dx = a.x - b.x;
	var dy = a.y - b.y;
	return Math.sqrt(Math.pow(dx, 2) + Math.pow(dy, 2));
}

function sign(a) {
	return a >=0 ? 1 : -1;
}

function rgb2Hex(r, g, b) {
	return '#' +
		clampInt(0, 255, r).toString(16) +
		clampInt(0, 255, g).toString(16) +
		clampInt(0, 255, b).toString(16);
}

function clampInt(lower, upper, x) {
	return Math.min(upper, Math.max(lower, Math.floor(x)));
}

function shannon(A, W) {
	return Math.log(A / W + 1) / Math.log(2);
}

function bgRect(d, dim) {
	return d.append('rect')
		.attr('cx', 0)
		.attr('cy', 0)
		.attr('width', dim.width)
		.attr('height', dim.height)
		.attr('class', 'back');
}

function RunningAverage(n) {
  this.buffer = [];
  this.size = n;

  this.process = function (num) {
    this.buffer.push(num);
    if (this.buffer.length > this.size) {
      this.buffer.shift(); // Remove the oldest number if the buffer size exceeds n
    }
    const sum = this.buffer.reduce((acc, num) => acc + num, 0);
    return sum / this.buffer.length;
  };

  this.clear = function () {
    this.buffer = [];
  };
}

// file system functions, data preparation

function addCsvFile(filePath) {
	if (path.extname(filePath).toLowerCase() === '.sd3') {
		// If the current item is a .sd3 file: create temp csv file (removing first row)
		var tempFilename = prepareSD3File(filePath);
		if (tempFilename!=null) {
			// add csv data file to processing list
			csvFileList.push({filePath:filePath, tempFilename: tempFilename});
		} 
		else console.log(`${filePath} is not a valid GoFitts .sd3 data file.`);
	}
}

function addCsvFolder(dir) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
		addCsvFolder(filePath);
    } else {
		addCsvFile(filePath);
	}
  });
}

function processCsvFiles() {
	if (csvFileList.length == 0) return;
	const {filePath,tempFilename} = csvFileList.shift();
	console.log ("path=",filePath," temp=",tempFilename);
	initData();
	fs.createReadStream(tempFilename)
	  .pipe(csv())
	  .on('data', (row) => {
		processNewDataRow(tempFilename,row);
	  })
	  .on('end', () => {
		createPlots(filePath);
		fs.unlinkSync(tempFilename);
		processCsvFiles();  // process next file from list
	  });
}

//// here the main action starts!

const program = new Command();

program
  .version('1.0')
  .description('plotFittsTrace.mjs <filename.sd3> - generate trace data plots from GoFitts .sd3 files')
  .argument('<filename>', 'the .sd3 trace data file or directory to process')
  .option('-p, --smoothPos [samples]', 'number of samples for smoothing position plots', '2')
  .option('-v, --smoothVel [samples]', 'number of samples for smoothing velocity plots', '4')
  .option('-o, --opacity [opacity]', 'opacity for ID scatter plots (0.5-1.0)', '0.8')
  .option('-g, --group', 'indicate groups of effective IDs by color', false)
  .option('-c, --captions', 'add axis captions', false)
  .option('-a, --amplitude [amplitude]', 'limit to trials with given amplitude', '0')
  .option('-w, --width [width]', 'limit to trials with given width', '0')
  ;

if (process.argv.length < 3) 
  program.help(); // display the usage message

program.parse(process.argv);
const options = program.opts();
// console.log(program.args)
options.filename=program.args[0]

if (!fs.existsSync(options.filename)) {
	console.log(`${options.filename} does not exist.`);
	process.exit(1);
}	

console.log(`Starting with the following options:`);
console.log(`  file/folder: ${options.filename}`);
console.log(`  position-smoothing: ${options.smoothPos} samples`);
console.log(`  velocity-smoothing: ${options.smoothVel} samples`);
console.log(`  opacity: ${options.opacity}`);
console.log(`  color groups: ${options.group}`);
console.log(`  captions: ${options.captions}`);
if (options.amplitude != 0) console.log(`  only trials with amplitude = ${options.amplitude}`);
if (options.width != 0) console.log(`  only trials with width = ${options.width}`);

const velAvg = new RunningAverage(options.smoothVel);
const xPosAvg = new RunningAverage(options.smoothPos);
const yPosAvg = new RunningAverage(options.smoothPos);

var csvFileList=[]
const stats = fs.statSync(options.filename);
if (stats.isFile()) {
  addCsvFile(options.filename);
} else if (stats.isDirectory()) {
  console.log(`processing directory ${options.filename}`); 
  addCsvFolder(options.filename);
} else {
  console.log(`${options.filename} is neither a file nor a directory.`);
  process.exit(1);
}

processCsvFiles();

