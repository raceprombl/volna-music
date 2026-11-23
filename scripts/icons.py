import math, struct, zlib
from pathlib import Path

def rounded(x,y,left,top,right,bottom,radius):
    dx=max(left+radius-x,0,x-(right-radius));dy=max(top+radius-y,0,y-(bottom-radius))
    return left<=x<=right and top<=y<=bottom and dx*dx+dy*dy<=radius*radius

out=Path('public/icons');out.mkdir(parents=True,exist_ok=True)
for size in (16,32,48,128):
    pixels=bytearray()
    for y in range(size):
        pixels.append(0)
        for x in range(size):
            colour=[0,0,0,0]
            for sy in (.25,.75):
                for sx in (.25,.75):
                    px,py=(x+sx)/size*128,(y+sy)/size*128
                    if rounded(px,py,0,0,128,128,35):
                        c=(255,220,96,255)
                        for center,height in ((31,23),(47,49),(64,72),(81,49),(97,23)):
                            if rounded(px,py,center-4,64-height/2,center+4,64+height/2,4):c=(37,33,15,255)
                        for i in range(4):colour[i]+=c[i]/4
            pixels.extend(round(v) for v in colour)
    def chunk(name,data):return struct.pack('!I',len(data))+name+data+struct.pack('!I',zlib.crc32(name+data)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(pixels)))+chunk(b'IEND',b'')
    (out/f'{size}.png').write_bytes(png)
print('Created four VOLNA PNG icons')
